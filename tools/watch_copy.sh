#!/bin/sh

root="${0%/*}/../"
cd "${root}" || exit 1

watch_dir="src"
watch_file="window-preferences.js"
src="build/window-preferences.js"
dest="${HOME}/.config/OpenRCT2/plugin/window-preferences.js"

main() {
	inotifywait -e close_write,moved_to,create -m "${watch_dir}" |
	while read -r directory events filename; do
		if [ "${filename}" = "${watch_file}" ]; then
			echo "Building ${src}..."
			make "${src}"
			echo "Updating ${dest}..."
			cp "${src}" "${dest}"
		fi
	done
}

main "$@"
