class_name UIController
extends CanvasLayer

signal start_game_requested()
signal zoom_in_pressed()
signal zoom_out_pressed()
signal zoom_reset_pressed()

var menu_panel: PanelContainer = null
var hud_root: Control = null
var status_label: Label = null
var prompt_label: Label = null
var toast_label: Label = null
var minimap_canvas: Control = null
var shading_btn: Button = null
var crowd_btn: Button = null
var turbo_cheat_btn: Button = null
var water_cheat_btn: Button = null

var dialogue_panel: PanelContainer = null
var portrait_rect: ColorRect = null
var portrait_initials: Label = null
var speaker_label: Label = null
var dialogue_text_label: Label = null

var _toast_timer: float = 0.0
var _map_player_pos := Vector2.ZERO
var _map_player_yaw: float = 0.0
var _map_raptor_pos := Vector2.ZERO
var _map_car_positions: Array[Vector2] = []
var _map_boat_positions: Array[Vector2] = []

func _ready() -> void:
	_build_hud()
	_build_dialogue_box()
	_build_main_menu()
	GameSettings.shading_changed.connect(func(_m: String) -> void: _refresh_option_buttons())
	GameSettings.crowdness_changed.connect(func(_c: String) -> void: _refresh_option_buttons())
	GameSettings.cheats_changed.connect(func() -> void: _refresh_option_buttons())
	_refresh_option_buttons()

func _process(delta: float) -> void:
	if _toast_timer > 0.0:
		_toast_timer -= delta
		if _toast_timer <= 0.0 and toast_label != null:
			toast_label.visible = false

func _build_hud() -> void:
	hud_root = Control.new()
	hud_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud_root.mouse_filter = Control.MOUSE_FILTER_PASS
	hud_root.visible = false
	add_child(hud_root)

	# Top-left HUD status panel
	var hud_box := PanelContainer.new()
	hud_box.position = Vector2(18.0, 18.0)
	hud_box.custom_minimum_size = Vector2(365.0, 132.0)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.08, 0.11, 0.18, 0.88)
	style.border_color = Color("#ffd166")
	style.set_border_width_all(3)
	style.set_corner_radius_all(12)
	style.set_content_margin_all(12)
	hud_box.add_theme_stylebox_override("panel", style)
	hud_root.add_child(hud_box)

	var vbox := VBoxContainer.new()
	hud_box.add_child(vbox)

	status_label = Label.new()
	status_label.text = "MECHA RAPTOR · PHASE 1"
	status_label.add_theme_color_override("font_color", Color("#f8f9fa"))
	status_label.add_theme_font_size_override("font_size", 15)
	vbox.add_child(status_label)

	# Camera Zoom Controls Bar (Zoom In / Out / Reset)
	var zoom_row := HBoxContainer.new()
	vbox.add_child(zoom_row)
	var z_lbl := Label.new()
	z_lbl.text = "Camera Zoom: "
	z_lbl.add_theme_color_override("font_color", Color("#ffd166"))
	zoom_row.add_child(z_lbl)

	var btn_in := Button.new()
	btn_in.text = " + In "
	btn_in.focus_mode = Control.FOCUS_NONE
	btn_in.pressed.connect(func() -> void: zoom_in_pressed.emit())
	zoom_row.add_child(btn_in)

	var btn_out := Button.new()
	btn_out.text = " - Out "
	btn_out.focus_mode = Control.FOCUS_NONE
	btn_out.pressed.connect(func() -> void: zoom_out_pressed.emit())
	zoom_row.add_child(btn_out)

	var btn_rst := Button.new()
	btn_rst.text = " Reset (0) "
	btn_rst.focus_mode = Control.FOCUS_NONE
	btn_rst.pressed.connect(func() -> void: zoom_reset_pressed.emit())
	zoom_row.add_child(btn_rst)

	# Top-right LEGO City Radar Minimap
	var map_panel := PanelContainer.new()
	map_panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	map_panel.offset_left = -206.0
	map_panel.offset_right = -18.0
	map_panel.offset_top = 18.0
	map_panel.offset_bottom = 206.0
	var map_style := StyleBoxFlat.new()
	map_style.bg_color = Color(0.06, 0.14, 0.22, 0.90)
	map_style.border_color = Color("#4cc9f0")
	map_style.set_border_width_all(3)
	map_style.set_corner_radius_all(12)
	map_style.set_content_margin_all(6)
	map_panel.add_theme_stylebox_override("panel", map_style)
	hud_root.add_child(map_panel)

	minimap_canvas = Control.new()
	minimap_canvas.custom_minimum_size = Vector2(170.0, 170.0)
	minimap_canvas.draw.connect(_draw_minimap)
	map_panel.add_child(minimap_canvas)

	# Bottom interaction prompt
	prompt_label = Label.new()
	prompt_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	prompt_label.offset_left = -310.0
	prompt_label.offset_right = 310.0
	prompt_label.offset_top = -68.0
	prompt_label.offset_bottom = -28.0
	prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_label.add_theme_font_size_override("font_size", 18)
	prompt_label.add_theme_color_override("font_color", Color("#ffd166"))
	hud_root.add_child(prompt_label)

	# Discovery / Notification Toast
	toast_label = Label.new()
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.offset_left = -260.0
	toast_label.offset_right = 260.0
	toast_label.offset_top = 24.0
	toast_label.offset_bottom = 68.0
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.add_theme_font_size_override("font_size", 22)
	toast_label.add_theme_color_override("font_color", Color("#06d6a0"))
	toast_label.visible = false
	hud_root.add_child(toast_label)

func _world_to_minimap(wx: float, wz: float, sz: Vector2) -> Vector2:
	# Map x in [-300..620] and z in [-310..310] into the minimap canvas
	var u := (wx + 310.0) / 950.0
	var v := (wz + 310.0) / 620.0
	return Vector2(clampf(u * sz.x, 4.0, sz.x - 4.0), clampf(v * sz.y, 4.0, sz.y - 4.0))

func _draw_minimap() -> void:
	if minimap_canvas == null:
		return
	var sz := minimap_canvas.size
	# Sea background
	minimap_canvas.draw_rect(Rect2(Vector2.ZERO, sz), Color("#1d4e6f"))

	# Main Island square
	var m_tl := _world_to_minimap(-280.0, -280.0, sz)
	var m_br := _world_to_minimap(280.0, 280.0, sz)
	minimap_canvas.draw_rect(Rect2(m_tl, m_br - m_tl), Color("#6ab04c"))

	# Palm Isle circle
	var p_c := _world_to_minimap(WorldTerrain.PALM_CENTER.x, WorldTerrain.PALM_CENTER.y, sz)
	minimap_canvas.draw_circle(p_c, 19.0, Color("#f2dca0"))
	minimap_canvas.draw_circle(p_c, 15.0, Color("#78e08f"))

	# Road grid
	for rc in WorldTerrain.ROAD_COORDS:
		var ns_a := _world_to_minimap(rc, -240.0, sz)
		var ns_b := _world_to_minimap(rc, 240.0, sz)
		minimap_canvas.draw_line(ns_a, ns_b, Color("#4a505c"), 2.0)
		var ew_a := _world_to_minimap(-240.0, rc, sz)
		var ew_b := _world_to_minimap(240.0, rc, sz)
		minimap_canvas.draw_line(ew_a, ew_b, Color("#4a505c"), 2.0)

	# Landmarks: Lab (Cyan), Grandma's Estate (Pink), Observatory (Blue)
	minimap_canvas.draw_circle(_world_to_minimap(-30.0, 28.0, sz), 4.0, Color("#5ef2ff"))
	minimap_canvas.draw_circle(_world_to_minimap(90.0, -90.0, sz), 4.0, Color("#ff8fab"))
	minimap_canvas.draw_circle(_world_to_minimap(-165.0, -165.0, sz), 4.0, Color("#4ea8de"))

	# Traffic Cars & Boats
	for cp in _map_car_positions:
		minimap_canvas.draw_circle(_world_to_minimap(cp.x, cp.y, sz), 1.8, Color("#ffd166"))
	for bp in _map_boat_positions:
		minimap_canvas.draw_circle(_world_to_minimap(bp.x, bp.y, sz), 2.2, Color("#f8f9fa"))

	# Mecha Raptor (Teal diamond/dot) & Player (Bright Red/White with heading line)
	var rp := _world_to_minimap(_map_raptor_pos.x, _map_raptor_pos.y, sz)
	minimap_canvas.draw_circle(rp, 4.2, Color("#06d6a0"))
	var pp := _world_to_minimap(_map_player_pos.x, _map_player_pos.y, sz)
	var h_dir := Vector2(sin(_map_player_yaw), cos(_map_player_yaw)) * 8.0
	minimap_canvas.draw_line(pp, pp + h_dir, Color("#ffffff"), 2.0)
	minimap_canvas.draw_circle(pp, 3.6, Color("#ffbe0b"))

func update_minimap(player_pos: Vector3, player_yaw: float, raptor_pos: Vector3, cars: Array[WorldActor], boats: Array[WorldActor]) -> void:
	_map_player_pos = Vector2(player_pos.x, player_pos.z)
	_map_player_yaw = player_yaw
	_map_raptor_pos = Vector2(raptor_pos.x, raptor_pos.z)
	_map_car_positions.clear()
	for c in cars:
		if is_instance_valid(c):
			_map_car_positions.append(Vector2(c.global_position.x, c.global_position.z))
	_map_boat_positions.clear()
	for b in boats:
		if is_instance_valid(b):
			_map_boat_positions.append(Vector2(b.global_position.x, b.global_position.z))
	if minimap_canvas != null and minimap_canvas.is_visible_in_tree():
		minimap_canvas.queue_redraw()

func _build_dialogue_box() -> void:
	dialogue_panel = PanelContainer.new()
	dialogue_panel.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	dialogue_panel.offset_left = -340.0
	dialogue_panel.offset_right = 340.0
	dialogue_panel.offset_top = -205.0
	dialogue_panel.offset_bottom = -78.0
	dialogue_panel.visible = false

	var d_style := StyleBoxFlat.new()
	d_style.bg_color = Color(0.07, 0.09, 0.15, 0.94)
	d_style.border_color = Color("#4cc9f0")
	d_style.set_border_width_all(3)
	d_style.set_corner_radius_all(14)
	d_style.set_content_margin_all(14)
	dialogue_panel.add_theme_stylebox_override("panel", d_style)
	add_child(dialogue_panel)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 16)
	dialogue_panel.add_child(hbox)

	# 2D Character Portrait Placeholder Frame (ready for custom 2D art!)
	portrait_rect = ColorRect.new()
	portrait_rect.custom_minimum_size = Vector2(92.0, 92.0)
	portrait_rect.color = Color("#4cc9f0")
	hbox.add_child(portrait_rect)

	portrait_initials = Label.new()
	portrait_initials.set_anchors_preset(Control.PRESET_FULL_RECT)
	portrait_initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	portrait_initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	portrait_initials.text = "2D\nART"
	portrait_initials.add_theme_font_size_override("font_size", 18)
	portrait_initials.add_theme_color_override("font_color", Color("#1d3557"))
	portrait_rect.add_child(portrait_initials)

	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hbox.add_child(text_col)

	speaker_label = Label.new()
	speaker_label.add_theme_font_size_override("font_size", 18)
	speaker_label.add_theme_color_override("font_color", Color("#ffd166"))
	text_col.add_child(speaker_label)

	dialogue_text_label = Label.new()
	dialogue_text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	dialogue_text_label.add_theme_font_size_override("font_size", 15)
	dialogue_text_label.add_theme_color_override("font_color", Color("#f8f9fa"))
	text_col.add_child(dialogue_text_label)

func _build_main_menu() -> void:
	menu_panel = PanelContainer.new()
	menu_panel.set_anchors_preset(Control.PRESET_CENTER)
	menu_panel.offset_left = -270.0
	menu_panel.offset_right = 270.0
	menu_panel.offset_top = -235.0
	menu_panel.offset_bottom = 235.0

	var m_style := StyleBoxFlat.new()
	m_style.bg_color = Color(0.08, 0.12, 0.22, 0.92)
	m_style.border_color = Color("#ffbe0b")
	m_style.set_border_width_all(4)
	m_style.set_corner_radius_all(18)
	m_style.set_content_margin_all(22)
	menu_panel.add_theme_stylebox_override("panel", m_style)
	add_child(menu_panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	menu_panel.add_child(vbox)

	var title := Label.new()
	title.text = "MECHA RAPTOR CITY"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", Color("#ffbe0b"))
	vbox.add_child(title)

	var sub := Label.new()
	sub.text = "Godot 4 Open-World Toybox · LEGO City Inspired"
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.add_theme_font_size_override("font_size", 14)
	sub.add_theme_color_override("font_color", Color("#a8dadc"))
	vbox.add_child(sub)

	var play_btn := Button.new()
	play_btn.text = "▶ PLAY / CONTINUE IN CITY"
	play_btn.custom_minimum_size = Vector2(0.0, 44.0)
	play_btn.pressed.connect(func() -> void:
		set_menu_visible(false)
		start_game_requested.emit()
	)
	vbox.add_child(play_btn)

	shading_btn = Button.new()
	shading_btn.custom_minimum_size = Vector2(0.0, 38.0)
	shading_btn.pressed.connect(func() -> void: GameSettings.cycle_shading(1))
	vbox.add_child(shading_btn)

	crowd_btn = Button.new()
	crowd_btn.custom_minimum_size = Vector2(0.0, 38.0)
	crowd_btn.pressed.connect(func() -> void: GameSettings.cycle_crowdness(1))
	vbox.add_child(crowd_btn)

	turbo_cheat_btn = Button.new()
	turbo_cheat_btn.custom_minimum_size = Vector2(0.0, 36.0)
	turbo_cheat_btn.pressed.connect(func() -> void: GameSettings.toggle_unlimited_turbo())
	vbox.add_child(turbo_cheat_btn)

	water_cheat_btn = Button.new()
	water_cheat_btn.custom_minimum_size = Vector2(0.0, 36.0)
	water_cheat_btn.pressed.connect(func() -> void: GameSettings.toggle_unlimited_water())
	vbox.add_child(water_cheat_btn)

	var controls_help := Label.new()
	controls_help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	controls_help.text = "WASD Move · Shift Run/Boost · Space Jump / Cut Parachute (LEGO 2 Skydive!) · E Ride Raptor/Car/Boat/Talk · 1/2/3/Q Mode (Walk/Flight/Race) · F Follow · R Call Raptor · T Feed Treat · Wheel/+/-/0 Zoom · Esc Menu"
	controls_help.add_theme_font_size_override("font_size", 12)
	controls_help.add_theme_color_override("font_color", Color("#dee2e6"))
	vbox.add_child(controls_help)

func _refresh_option_buttons() -> void:
	if shading_btn != null:
		shading_btn.text = "Shading Preset: %s" % GameSettings.get_shading_name()
	if crowd_btn != null:
		crowd_btn.text = "Crowdness Density: %s" % GameSettings.get_crowdness_name()
	if turbo_cheat_btn != null:
		turbo_cheat_btn.text = "Cheat · Unlimited Turbo: %s" % ("ON" if GameSettings.unlimited_turbo else "OFF")
	if water_cheat_btn != null:
		water_cheat_btn.text = "Cheat · Unlimited Water: %s" % ("ON" if GameSettings.unlimited_water else "OFF")

func set_menu_visible(vis: bool) -> void:
	if menu_panel != null:
		menu_panel.visible = vis
	if hud_root != null:
		hud_root.visible = not vis

func show_toast(msg: String, duration: float = 3.2) -> void:
	if toast_label == null:
		return
	toast_label.text = msg
	toast_label.visible = true
	_toast_timer = duration

func show_dialogue(actor_name: String, role: String, text: String, color_hex: String) -> void:
	if dialogue_panel == null:
		return
	dialogue_panel.visible = true
	portrait_rect.color = Color(color_hex)
	portrait_initials.text = "[2D ART]\n" + actor_name.left(6).to_upper()
	speaker_label.text = "%s — %s" % [actor_name, role]
	dialogue_text_label.text = text

func hide_dialogue() -> void:
	if dialogue_panel != null:
		dialogue_panel.visible = false

func update_hud(mode_str: String, alt: float, thruster: float, overheated: bool, water: float, follow: bool, zoom_mult: float, prompt: String) -> void:
	if status_label != null:
		var zone := "SPACE (Moon Gravity)" if alt >= WorldTerrain.SPACE_Y else ("SKY LAYER" if alt > 110.0 else "LEGO CITY ISLAND")
		var th_str := "INF" if GameSettings.unlimited_turbo else ("%d%%%s" % [int(thruster), " [OVERHEAT]" if overheated else ""])
		var wt_str := "INF" if GameSettings.unlimited_water else ("%d%%" % int(water))
		status_label.text = (
			"Mode: %s  |  Zone: %s (Alt %dm)\n" % [mode_str.to_upper(), zone, int(alt)] +
			"Thruster: %s  |  Water: %s  |  Follow [F]: %s\n" % [th_str, wt_str, "ON" if follow else "OFF"] +
			"Lab Points: %d  |  Treats [T]: %d  |  Zoom: %d%%" % [GameSettings.lab_points, GameSettings.treats_count, int(round(zoom_mult * 100.0))]
		)
	if prompt_label != null:
		prompt_label.text = prompt
