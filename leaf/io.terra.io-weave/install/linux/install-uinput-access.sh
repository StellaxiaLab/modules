#!/bin/sh
# Grant this node's Terra daemon access to /dev/uinput (D-25).
#
#   sudo ./install-uinput-access.sh [user]
#
# The user defaults to whoever invoked sudo. Run with no privileges and it
# tells you what it would have done and stops — a failed install must not look
# like a finished one.
#
# Removing it again is uninstall-uinput-access.sh next door. A rule left behind
# by a module that is gone is a device an uninstalled module could still open.
set -eu

GROUP_NAME=terra-input
RULE_NAME=70-terra-uinput.rules
RULE_DESTINATION=/etc/udev/rules.d/$RULE_NAME
SOURCE_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_USER=${1:-${SUDO_USER:-$(id -un)}}

if [ "$(id -u)" -ne 0 ]; then
	echo "This needs root. It would:" >&2
	echo "  groupadd -f $GROUP_NAME" >&2
	echo "  usermod -aG $GROUP_NAME $TARGET_USER" >&2
	echo "  install -m 0644 $SOURCE_DIRECTORY/$RULE_NAME $RULE_DESTINATION" >&2
	echo "  modprobe uinput && udevadm control --reload-rules && udevadm trigger --sysname-match=uinput" >&2
	echo "Re-run with sudo, or run those five lines yourself." >&2
	exit 1
fi

if ! getent group "$GROUP_NAME" >/dev/null 2>&1; then
	groupadd -f "$GROUP_NAME"
	echo "created group $GROUP_NAME"
fi
usermod -aG "$GROUP_NAME" "$TARGET_USER"
install -m 0644 "$SOURCE_DIRECTORY/$RULE_NAME" "$RULE_DESTINATION"

# uinput is usually built in, but on a kernel that ships it as a module the
# node does not exist until something loads it, and the rule above has nothing
# to apply to. The modules-load.d entry is what makes that survive a reboot.
modprobe uinput 2>/dev/null || true
if [ -d /etc/modules-load.d ]; then
	echo uinput > /etc/modules-load.d/terra-uinput.conf
fi

udevadm control --reload-rules
udevadm trigger --sysname-match=uinput

echo "installed $RULE_DESTINATION and added $TARGET_USER to $GROUP_NAME"
echo
echo "Group membership does not reach a process that is already running, so the"
echo "daemon has to be restarted (or $TARGET_USER has to log in again) before"
echo "io-weave can open /dev/uinput. Check it by OPENING the device rather than"
echo "by reading the group list -- the group list will say yes first:"
echo
echo "  sudo -u $TARGET_USER sh -c ': > /dev/uinput' && echo openable"
