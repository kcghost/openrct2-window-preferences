var name = 'Window Preferences';
var author = 'Casey Fitzpatrick';
var prefix = [author, name].join('.').toLowerCase().replaceAll(' ','_')

var win_interval = 25; // check time in ms
var interval_handle = null;

var last_windows = [];
var new_windows = [];
var win_prefs = {};
var new_window = null;

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
	if(w.classification == 225) {
		id = id + "." + w.title.trim().toLowerCase().replaceAll(' ','_');
	}
	size = [String(w.minHeight),
		String(w.maxHeight),
		String(w.minWidth),
		String(w.maxWidth)].join('-');
	// ignore sizing for scenery window since it has awkward dynamic sizing
	if(w.classification == 18) { size = "def_sz"; }
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
	if(w.classification == 18) { return; }
	if(!(size in win_prefs[id])) { win_prefs[id][size] = {}; }
	win_prefs[id][size].width = w.width;
	win_prefs[id][size].height = w.height;
}

function apply_prefs(w, open=true) {
	[id, size] = make_id(w);

	if(id in win_prefs) {
		if(open && settings.restore_pos_open) {
			w.x = win_prefs[id].x;
			w.y = win_prefs[id].y;
		}
		if(open && !settings.restore_size_open) { return; }
		if(!settings.restore_size_change) { return; }
		if(w.classification == 18) { return; }
		// todo: force largest sizing
		if(size in win_prefs[id]) {
			gradual_resize(w, win_prefs[id][size].width, win_prefs[id][size].height);
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
	// custom windows use "number" but are not multiples of the same type
	if(w.number && w.classification != 225) {
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
	if(settings.collision == 1) {
		collide_right(w.i);
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
	// nothing, pushright/close
	"collision": 1,
	// normal, force no shrink, max to screen
	"resize": 0
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
		settings.resize != 0) {
	
		interval_handle = context.setInterval(detect_changes, win_interval);
	}
	context.sharedStorage.set(prefix + '.settings', settings);
}

function window_settings() {
	ui.openWindow({
		title: name,
		x: (ui.width / 2) - 100,
		y: 27,
		width: 200,
		height: 220,
		widgets: [
			{
				type: 'groupbox',
				x: 5,
				y: 20,
				width: 190,
				height: 125,
				text: 'Position & Sizing',
			},
			{
				type: 'checkbox',
				x: 10,
				y: 38,
				width: 190,
				height: 12,
				text: 'Save positions',
				isChecked: settings.save_pos,
				onChange: function(en) {
					settings.save_pos = en;
					update_settings();
				}
			},
			{
				type: 'checkbox',
				x: 10,
				y: 50,
				width: 190,
				height: 12,
				text: 'Save sizes',
				isChecked: settings.save_size,
				onChange: function(en) {
					settings.save_size = en;
					update_settings();
				}
			},
			{
				type: 'checkbox',
				x: 10,
				y: 62,
				width: 190,
				height: 12,
				text: 'Restore positions on open',
				isChecked: settings.restore_pos_open,
				onChange: function(en) {
					settings.restore_pos_open = en;
					update_settings();
				}
			},
			{
				type: 'checkbox',
				x: 10,
				y: 74,
				width: 190,
				height: 12,
				text: 'Restore sizes on open',
				isChecked: settings.restore_size_open,
				onChange: function(en) {
					settings.restore_size_open = en;
					update_settings();
				}
			},
			{
				type: 'checkbox',
				x: 10,
				y: 86,
				width: 190,
				height: 12,
				text: 'Restore sizes on tab switch',
				isChecked: settings.restore_size_change,
				onChange: function(en) {
					settings.restore_size_change = en;
					update_settings();
				}
			},
			{
				type: 'button',
				x: 10,
				y: 105,
				width: 180,
				height: 15,
				text: 'Clear current preferences',
				onClick: reset_prefs,
			},
			{
				type: 'button',
				x: 10,
				y: 124,
				width: 180,
				height: 15,
				text: 'Save current as default',
				onClick: save_defaults,
			},
			{
				type: 'groupbox',
				x: 5,
				y: 150,
				width: 190,
				height: 65,
				text: 'Other',
			},
			{
				type: 'label',
				x: 10,
				y: 165,
				width: 100,
				height: 15,
				text: 'Collision',
			},
			{
				type: 'dropdown',
				x: 65,
				y: 165,
				width: 125,
				height: 15,
				selectedIndex: settings.collision,
				items: ['Nothing', 'Push right & close'],
				onChange: function(i) { settings.collision = i; update_settings(); },
			},
			{
				type: 'label',
				x: 10,
				y: 183,
				width: 100,
				height: 15,
				text: 'Resize',
			},
			{
				type: 'dropdown',
				x: 65,
				y: 183,
				width: 125,
				height: 15,
				selectedIndex: settings.resize,
				items: ['Normal', 'Force no shrink', 'Force max to screen'],
				onChange: function(i) { settings.resize = i; update_settings(); },
			},
		]
	});
}

function main() {
	if(typeof ui == 'undefined') {
		return;
	}

	ui.registerMenuItem(name, window_settings);
	ui.registerShortcut({
		id: prefix + '.window_settings',
		text: '[' + name + ']' + " Open",
		bindings: ["CTRL+SHIFT+O"],
		callback() {
			window_settings();
		}
	});
	
	var s = context.sharedStorage.get(prefix + '.settings');
	if(s) { settings = s; }
	var p = context.sharedStorage.get(prefix + '.prefs');
	if(p) { win_prefs = p; }
	update_settings();
};

registerPlugin({
	name: name,
	version: '1.0',
	authors: [author],
	licence: 'MIT',
	// todo: unsure if older versions may work fine
	targetApiVersion: 117,
	minApiVersion: 117,
	type: 'local',

	main: main
});
