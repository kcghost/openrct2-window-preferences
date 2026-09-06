.PHONY: all

VERSION := $(shell git describe --abbrev --tags)

all: build/window-preferences.js

build/window-preferences.js: src/window-preferences.js
	esbuild --define:DEF_VERSION=\"$(VERSION)\" --bundle --minify --outfile=$@  $<
