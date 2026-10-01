//go:build windows

package discovery

import (
	"errors"
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

// Windows enumeration goes through cfgmgr32's device instance list rather than
// RawInput, for two reasons. The instance list is a PnP query, so it answers the
// same way from a service in session 0 — which is where the module host runs
// modules (terra-module-host/process_window_windows.go) — and it reports every
// present device class, not only the three RawInput knows about.
//
// What a device *is* comes from the registry key the PnP manager keeps for each
// instance: ClassGUID says what it is, FriendlyName or DeviceDesc says what to
// call it.
const (
	crSuccess     = 0
	crBufferSmall = 0x0000001A
	// CM_GETIDLIST_FILTER_PRESENT — devices attached right now, which is what
	// presence means here.
	filterPresent = 0x00000100
	// The list can grow between being sized and being read, so the read is
	// retried before it is called a failure.
	listAttempts = 4
	enumKeyRoot  = `SYSTEM\CurrentControlSet\Enum\`
)

var (
	cfgmgr32              = syscall.NewLazyDLL("cfgmgr32.dll")
	procDeviceIDListSizeW = cfgmgr32.NewProc("CM_Get_Device_ID_List_SizeW")
	procDeviceIDListW     = cfgmgr32.NewProc("CM_Get_Device_ID_ListW")
)

func enumerate() ([]Found, error) {
	instances, err := presentInstanceIDs()
	if err != nil {
		return nil, err
	}
	found := make([]Found, 0, len(instances))
	for _, instance := range instances {
		class, name, ok := describeInstance(instance)
		if !ok {
			continue
		}
		// The instance ID answers two questions at once and they are read
		// apart: cfgmgr32 addresses the device by the whole string, while the
		// device id rests on the model and serial inside it (instanceid.go).
		found = append(found, Found{Key: instance, Class: class, Name: name, Identity: parseWindowsInstanceID(instance)})
	}
	return found, nil
}

// presentInstanceIDs asks the PnP manager for every device instance that is
// attached right now.
func presentInstanceIDs() ([]string, error) {
	for attempt := 0; attempt < listAttempts; attempt++ {
		var length uint32
		ret, _, _ := procDeviceIDListSizeW.Call(uintptr(unsafe.Pointer(&length)), 0, filterPresent)
		if ret != crSuccess {
			return nil, fmt.Errorf("CM_Get_Device_ID_List_SizeW: CONFIGRET 0x%X", ret)
		}
		if length == 0 {
			return nil, nil
		}
		buffer := make([]uint16, length)
		ret, _, _ = procDeviceIDListW.Call(0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(length), filterPresent)
		if ret == crBufferSmall {
			continue
		}
		if ret != crSuccess {
			return nil, fmt.Errorf("CM_Get_Device_ID_ListW: CONFIGRET 0x%X", ret)
		}
		return splitDoubleNull(buffer), nil
	}
	return nil, errors.New("device instance list kept growing while it was read")
}

// setupClassNames maps the fixed, documented setup class GUIDs onto the
// package's canonical class tokens.
//
// The GUID is what gets read rather than the `Class` value beside it, because
// current Windows builds do not write `Class` on every device instance key —
// measured on this machine, where every instance had ClassGUID and none had
// Class. The GUID is also the stabler of the two: it is the same on every
// Windows install and in every locale.
var setupClassNames = map[string]string{
	"{4D36E96F-E325-11CE-BFC1-08002BE10318}": classMouse,
	"{4D36E96B-E325-11CE-BFC1-08002BE10318}": classKeyboard,
	"{745A17A0-74D3-11D0-B6FE-00A0C90F57DA}": classRawInput,
}

// setupClassName gives the class its Terra name, or hands the GUID back
// unchanged so an unmapped class still shows up in a debug log as itself.
// kindFor is where the decision to skip it is made.
func setupClassName(guid string) string {
	normalized := strings.ToUpper(strings.TrimSpace(guid))
	if name, ok := setupClassNames[normalized]; ok {
		return name
	}
	return normalized
}

// describeInstance reads the registry values the mapping needs.
//
// An instance whose key cannot be opened is skipped rather than reported with an
// unknown class: parts of Enum carry restrictive ACLs, and a device we cannot
// read is not a device we can describe. This is a per-device skip, not a failed
// scan — a failed scan is what presentInstanceIDs returns an error for.
func describeInstance(instance string) (class string, name string, ok bool) {
	key, err := openEnumKey(instance)
	if err != nil {
		return "", "", false
	}
	defer syscall.RegCloseKey(key)

	guid, ok := regString(key, "ClassGUID")
	if !ok {
		return "", "", false
	}
	class = setupClassName(guid)
	if friendly, found := regString(key, "FriendlyName"); found {
		name = friendly
	} else {
		name, _ = regString(key, "DeviceDesc")
	}
	return class, name, true
}

func openEnumKey(instance string) (syscall.Handle, error) {
	path, err := syscall.UTF16PtrFromString(enumKeyRoot + instance)
	if err != nil {
		return 0, err
	}
	var handle syscall.Handle
	if err := syscall.RegOpenKeyEx(syscall.HKEY_LOCAL_MACHINE, path, 0, syscall.KEY_READ, &handle); err != nil {
		return 0, err
	}
	return handle, nil
}

// regString reads one string value. A missing value is not an error here — most
// device keys carry DeviceDesc and only some carry FriendlyName.
func regString(key syscall.Handle, name string) (string, bool) {
	namePointer, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return "", false
	}
	var valueType uint32
	var size uint32
	if err := syscall.RegQueryValueEx(key, namePointer, nil, &valueType, nil, &size); err != nil || size == 0 {
		return "", false
	}
	if valueType != syscall.REG_SZ && valueType != syscall.REG_EXPAND_SZ && valueType != syscall.REG_MULTI_SZ {
		return "", false
	}
	buffer := make([]byte, size)
	if err := syscall.RegQueryValueEx(key, namePointer, nil, &valueType, &buffer[0], &size); err != nil {
		return "", false
	}
	// The value arrives as bytes; the registry stores UTF-16. UTF16ToString
	// stops at the first NUL, which is also what makes a MULTI_SZ read as its
	// first entry — enough for the descriptions read here.
	characters := make([]uint16, 0, size/2)
	for index := 0; index+1 < int(size); index += 2 {
		characters = append(characters, uint16(buffer[index])|uint16(buffer[index+1])<<8)
	}
	value := syscall.UTF16ToString(characters)
	if value == "" {
		return "", false
	}
	return value, true
}

// splitDoubleNull cuts a PZZWSTR — the run of NUL-terminated strings that ends
// with an empty one — into Go strings.
func splitDoubleNull(buffer []uint16) []string {
	values := make([]string, 0, 32)
	for index := 0; index < len(buffer); {
		end := index
		for end < len(buffer) && buffer[end] != 0 {
			end++
		}
		if end == index {
			// The empty string terminates the list.
			break
		}
		values = append(values, syscall.UTF16ToString(buffer[index:end]))
		index = end + 1
	}
	return values
}
