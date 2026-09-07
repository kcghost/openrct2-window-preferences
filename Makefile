.PHONY: all clean deploy

VERSION := $(shell git describe --abbrev --tags)

all: build/window-preferences.js

build/window-preferences.js: src/window-preferences.js
	esbuild --define:DEF_VERSION=\"$(VERSION)\" --bundle --minify --outfile=$@  $<

clean:
	rm -f build/window-preferences.js

deploy: build/window-preferences.js
	cp $< ~/.config/OpenRCT2/plugin/window-preferences.js
