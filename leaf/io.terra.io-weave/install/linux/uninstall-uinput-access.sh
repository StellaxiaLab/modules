#!/bin/sh
# Take back what install-uinput-access.sh granted (D-25).
#
#   sudo ./uninstall-uinput-access.sh
#
# The group is left in place on purpose: other things may have been added to
# it, and a group with no rule grants nothing. The rule is what has to go.
set -eu

RULE_DESTINATION=/etc/udev/rules.d/70-terra-uinput.rules

if [ "$(id -u)" -ne 0 ]; then
	echo "This needs root. It would remove $RULE_DESTINATION and reload udev." >&2
	exit 1
fi

rm -f "$RULE_DESTINATION" /etc/modules-load.d/terra-uinput.conf
udevadm control --reload-rules
udevadm trigger --sysname-match=uinput
echo "removed $RULE_DESTINATION; /dev/uinput is root-only again"
