import Oui from "../external/OliUI/build/OliUI.js"

var name = 'Window Preferences';
var author = 'Casey Fitzpatrick';
var prefix = [author, name].join('.').toLowerCase().replaceAll(' ','_')

var win_interval = 25; // check time in ms
var interval_handle = null;
var settings_window = null;

var last_windows = [];
var new_windows = [];
var win_prefs = {};
var new_window = null;

// constantly fights resizing for it's drawer feature
const CLASS_SCENERY  = 18;
// TODO: figure better solutions for finance window
// finance seems to lie about it's own sizing? something odd is going on with it
const CLASS_FINANCE  = 28;
const CLASS_RIDE     = 12;
const CLASS_PEEP     = 12;
const CLASS_VIEWPORT = 112;
const CLASS_STAFF    = 220;
// custom uses number as differentiator between custom types rather than multiples
const CLASS_CUSTOM   = 225;

// window types that allow for multiple of the same type to be on screen at once
const CLASSES_MULT = [ CLASS_RIDE, CLASS_PEEP, CLASS_VIEWPORT, CLASS_STAFF ];
// annoying to size
const CLASSES_DONTSIZE = [ CLASS_SCENERY, CLASS_FINANCE ];

function check_collision(a, b) {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

// classification + number == unique window id
function same_window(a, b) {
	return (
		a.classification == b.classification &&
		a.number == b.number
	);
}

// windows with viewports (guests, staff, etc) have trouble resizing all at once
// resize gradually like it might be done by a mouse drag
function gradual_resize(w, width, height) {
	// to avoid infinite loop don't trust that assignments will actually take
	var iw = w.width;
	var ih = w.height;
	while(Math.abs(iw - width) >= 10 || Math.abs(ih - height) >= 10) {
		if((iw + 10) <= width) {  iw += 10; w.width  += 10; }
		if((iw - 10) >= width) {  iw -= 10; w.width  -= 10; }
		if((ih + 10) <= height) { ih += 10; w.height += 10; }
		if((ih - 10) >= height) { ih -= 10; w.height -= 10; }
	}
	w.width = width;
	w.height = height;
}

// same window type for looking up window preferences
// tabIndex itself is worthless, it's always 0 for native windows
// window preferences for position and preferred size per unique min/max size (usually tab)
function make_id(w) {
	id = String(w.classification);
	// custom windows need further id by title
	if(w.classification == CLASS_CUSTOM) {
		id = id + "." + w.title.trim().toLowerCase().replaceAll(' ','_');
	}
	size = [String(w.minHeight),
		String(w.maxHeight),
		String(w.minWidth),
		String(w.maxWidth)].join('-');
	// ignore sizing for scenery window since it has awkward dynamic sizing
	if(CLASSES_DONTSIZE.includes(w.classification)) { size = "def_sz"; }
	return [id, size];
}

function update_prefs(w) {
	[id, size] = make_id(w);

	if(!(id in win_prefs)) { win_prefs[id] = {}; }
	if(settings.save_pos) {
		win_prefs[id].x = w.x;
		win_prefs[id].y = w.y;
	}

	if(!settings.save_size) { return; }
	if(CLASSES_DONTSIZE.includes(w.classification)) { return; }
	if(!(size in win_prefs[id])) { win_prefs[id][size] = {}; }
	win_prefs[id][size].width = w.width;
	win_prefs[id][size].height = w.height;
}

function apply_prefs(w, open=true) {
	[id, size] = make_id(w);

	if(id in win_prefs) {
		if(open && settings.restore_pos_open) {
			// only apply if it can be placed on screen
			if(win_prefs[id].x < ui.width && win_prefs[id].y < ui.height) {
				w.x = win_prefs[id].x;
				w.y = win_prefs[id].y;
			}
		}
		if(open && !settings.restore_size_open) { return; }
		if(!settings.restore_size_change) { return; }
		if(CLASSES_DONTSIZE.includes(w.classification)) { return; }
		if(size in win_prefs[id]) {
			if(win_prefs[id][size].width < ui.width && win_prefs[id][size].height < ui.height) {
				gradual_resize(w, win_prefs[id][size].width, win_prefs[id][size].height);
			}
		}
	}
}

// typically tab changes that result in min/max changes
function window_changed(lw, w) {
	if(settings.resize == 1) {
		if(w.maxWidth < lw.maxWidth || w.maxHeight < lw.maxHeight) {
			// anti-shrink maximums
			w.maxWidth = lw.maxWidth;
			w.maxHeight = lw.maxHeight;
		}
	}
	if(settings.resize == 2) {
		w.maxWidth = ui.width;
		w.maxHeight = ui.height;
	}
	// anti-shrink
	if(settings.resize == 1 || settings.resize == 2) {
		if(w.width < lw.width || w.height < lw.height) {
			gradual_resize(w, lw.width, lw.height);
		}
	}
	apply_prefs(w, open=false);
}

// for both move and resize
function window_moved(w) {
	// only count leftmost windows if a window class supports multiples
	if(CLASSES_MULT.includes(w.classification)) {
		for(var i = 0; i < new_windows.length; i++) {
			nw = new_windows[i];
			if(w.classification == nw.classification) {
				if(nw.x < w.x) { return; }
			}
		}
	}
	update_prefs(w);
}

function collide_right(i) {
	// resolve collisions by moving windows to the right
	for(var j = 0; j < ui.windows; j++) {
		if(j == i) { continue; }
		var jw = ui.getWindow(j);
		if(jw.isSticky) { continue; }

		for(var k = 0; k < ui.windows; k++) {
			if(j == k) { continue; }
			var kw = ui.getWindow(k);
			if(kw.isSticky) {continue; }

			if(check_collision(jw, kw)) {
				if((kw.x + kw.width + jw.width) <= ui.width) {
					jw.x = kw.x + kw.width;
				} else {
					// close topmost
					if(jw > kw) {
						kw.close();
					} else {
						jw.close();
					}
				}
				// reset
				j = 0; k = 0; break;
			}
		}
	}
}

function window_new(w) {
	if(settings.resize == 2) {
		w.maxWidth = ui.width;
		w.maxHeight = ui.height;
	}
	if(settings.restore_pos_open) {
		// move new window to preferred position if available
		apply_prefs(w);

		// move back windows that were displaced by new window before it was moved
		for(var i = 0; i < last_windows.length; i++) {
			for(var j = 0; j < ui.windows; j++) {
				var jw = ui.getWindow(j);
				if(same_window(last_windows[i], jw)) {
					jw.x = last_windows[i].x;
					jw.y = last_windows[i].y;
				}
			}
		}
	}
	if(CLASSES_MULT.includes(w.classification)) {
		if(settings.collision_mult == 1) {
			collide_right(w.i);
		}
	} else {
		if(settings.collision == 1) {
			collide_right(w.i);
		}
	}
}

// calls window_change, window_move, window_new as appropriate
function detect_changes() {
	new_windows = [];
	var new_window = null;
	for(var i = 0; i < ui.windows; i++) {
		var w = ui.getWindow(i);
		if(w.isSticky) { continue; }
		// copy useful properties
		new_windows.push({
			i: i,
			classification: w.classification,
			title: w.title,
			tabIndex: w.tabIndex,
			number: w.number,
			x: w.x,
			y: w.y,
			width: w.width,
			height: w.height,
			minWidth: w.minWidth,
			maxWidth: w.maxWidth,
			minHeight: w.minHeight,
			maxHeight: w.maxHeight,
		});
		if(!last_windows.some(b => same_window(w,b))) {
			new_window = w;
		}
	}
	
	// if no new window to handle then just update the last known positions
	// and window preferences - maybe make sizing consistent
	if(!new_window) {
		for(var i = 0; i < last_windows.length; i++) {
			lw = last_windows[i];
			for(var j = 0; j < new_windows.length; j++) {
				nw = new_windows[j];
				if(!same_window(lw,nw)) { continue; }
				// sometimes when windows are closed they are briefly all 0 properties, dont save
				if(!nw.width) { continue; }

				// detect new tab
				// 18 == scenery picker, it's drawer behavior screws up resizing
				if(nw.classification != 18 && (
					nw.maxWidth != lw.maxWidth ||
					nw.maxHeight != lw.maxHeight
				)) {
					w = ui.getWindow(nw.i);
					window_changed(lw, w);
					// don't want window_changed to trigger detection on next loop
					nw.x = w.x;
					nw.y = w.y;
					nw.width = w.width;
					nw.height = w.height;
					nw.maxWidth = w.maxWidth;
					nw.maxHeight = w.maxHeight;
				} else {
					if(
						lw.x != nw.x ||
						lw.y != nw.y ||
						lw.width != nw.width ||
						lw.height != nw.height) {
						w = ui.getWindow(nw.i);
						window_moved(w);
					}
				}
			}
		}
		last_windows = new_windows;
		return;
	}

	window_new(new_window);
	// refresh window cache so it doesn't trigger from changes in window_new
	last_windows = [];
	for(var i = 0; i < ui.windows; i++) {
		var w = ui.getWindow(i);
		if(w.isSticky) { continue; }
		// copy useful properties
		last_windows.push({
			i: i,
			classification: w.classification,
			title: w.title,
			tabIndex: w.tabIndex,
			number: w.number,
			x: w.x,
			y: w.y,
			width: w.width,
			height: w.height,
			minWidth: w.minWidth,
			maxWidth: w.maxWidth,
			minHeight: w.minHeight,
			maxHeight: w.maxHeight,
		});
	}
};

// convenience shortcut for closing window types that clog up the screen with multiples
function close_multiples() {
	for(var i = 0; i < ui.windows; i++) {
		var w = ui.getWindow(i);
		if(CLASSES_MULT.includes(w.classification)) {
			w.close();
		}
	}
}

function reset_prefs() {
	win_prefs = {};
}

function save_defaults() {
	context.sharedStorage.set(prefix + '.prefs', win_prefs);
}

var settings = {
	"save_pos": true,
	"save_size": true,
	"restore_pos_open": true,
	"restore_size_open": true,
	"restore_size_change": true,
	// normal, force no shrink, max to screen
	"resize": 0,
	// nothing, pushright/close
	"collision": 0,
	"collision_mult": 1,
};

function update_settings() {
	if(interval_handle) {
		context.clearInterval(interval_handle);
		interval_handle = null;
	}
	if(
		settings.save_pos ||
		settings.save_size ||
		settings.restore_pos_open ||
		settings.restore_size_change ||
		settings.collision != 0 ||
		settings.collision_mult != 0 ||
		settings.resize != 0) {
	
		interval_handle = context.setInterval(detect_changes, win_interval);
	}
	context.sharedStorage.set(prefix + '.settings', settings);
}

// tie setting to OliUI checkbox widget
function add_setting_checkbox(parent, label, key) {
	checkbox = new Oui.Widgets.Checkbox(label, function(t) {
		settings[key] = t;
		update_settings();
	});
	parent.addChild(checkbox);
	checkbox.setChecked(settings[key]);
}

// Make a labeled dropdown and tie to setting
function add_setting_dropdown(parent, label, labels, key) {
	box = new Oui.HorizontalBox();
	label = new Oui.Widgets.Label(label);
	dropdown = new Oui.Widgets.Dropdown(labels, function(t) {
		settings[key] = t;
		update_settings();
	});
	// no legitimate setter??
	dropdown._selectedIndex = settings[key];
	label.setRelativeWidth(50);
	dropdown.setRelativeWidth(50);
	box.addChild(label);
	box.addChild(dropdown);
	parent.addChild(box);
}

// build window using OliUI, easier to re-arrange and manage than manually creating the window desc
function build_window() {
	// classification (as string in WindowDesc), title
	// I have no idea where classification as string ends up for custom windows
	// normally "classification" is a r/o number in the Window interface
	window = new Oui.Window(name, name);
	window.setWidth(300); 

	posbox = new Oui.GroupBox("Position & Sizing");
	window.addChild(posbox);

	add_setting_checkbox(posbox, "Save Positions", "save_pos");
	add_setting_checkbox(posbox, "Save Sizes", "save_size");
	add_setting_checkbox(posbox, "Restore positions on open", "restore_pos_open");
	add_setting_checkbox(posbox, "Restore sizes on open", "restore_size_open");
	add_setting_checkbox(posbox, "Restore sizes on tab switch", "restore_size_change");
	add_setting_dropdown(posbox, "Experimental sizing", ['Normal', 'Force no shrink', 'Force max to screen'], "resize");

	colbox = new Oui.GroupBox("Collision Handling");
	window.addChild(colbox);

	add_setting_dropdown(colbox, "Single-instance windows", ['Do nothing', 'Push right, close edge'], "collision");
	add_setting_dropdown(colbox, "Multi-instance windows", ['Do nothing', 'Push right, close edge'], "collision_mult");

	window.addChild(new Oui.Widgets.Button("Clear current positions/sizes", reset_prefs));
	window.addChild(new Oui.Widgets.Button("Save current positions/sizes as default", save_defaults));

	return window;
}

function open_settings_window() {
	settings_window.open();
}

function main() {
	if(typeof ui == 'undefined') {
		return;
	}

	ui.registerMenuItem(name, open_settings_window);
	ui.registerShortcut({
		id: prefix + '.window_settings',
		text: '[' + name + ']' + " Open",
		bindings: ["CTRL+SHIFT+O"],
		callback() {
			open_settings_window();
		}
	});
	ui.registerShortcut({
		id: prefix + '.close_multiples',
		text: '[' + name + ']' + " Close multiples windows",
		bindings: ["CTRL+BACKSPACE"],
		callback() {
			close_multiples();
		}
	});
	
	var s = context.sharedStorage.get(prefix + '.settings');
	if(s) { settings = s; }
	var p = context.sharedStorage.get(prefix + '.prefs');
	if(p) { win_prefs = p; }
	update_settings();

	settings_window = build_window();
};

registerPlugin({
	name: name,
	version: DEF_VERSION,
	authors: [author],
	licence: 'MIT',
	// todo: unsure if older versions may work fine
	targetApiVersion: 117,
	minApiVersion: 117,
	type: 'local',

	main: main
});
