extends Node

signal shading_changed(mode: String)
signal crowdness_changed(level: String)
signal cheats_changed()

const SHADING_MODES: Array[String] = ["Flat Low-Poly", "LEGO Glossy / Toon", "High (PBR + Glow)"]
const CROWDNESS_LEVELS: Array[String] = ["Low", "Medium", "High", "Packed"]

var shading_index: int = 1
var crowdness_index: int = 1
var unlimited_turbo: bool = false
var unlimited_water: bool = false
var lab_points: int = 120
var treats_count: int = 5

var _std_mats: Dictionary = {}
var _toon_shader: Shader = null

func _ready() -> void:
	_toon_shader = load("res://shaders/toon_material.gdshader") as Shader

func get_shading_name() -> String:
	return SHADING_MODES[shading_index]

func cycle_shading(dir: int = 1) -> void:
	shading_index = posmod(shading_index + dir, SHADING_MODES.size())
	_update_all_materials()
	shading_changed.emit(get_shading_name())

func get_crowdness_name() -> String:
	return CROWDNESS_LEVELS[crowdness_index]

func get_crowdness_multiplier() -> float:
	match crowdness_index:
		0: return 0.45
		1: return 1.0
		2: return 1.65
		_: return 2.35

func cycle_crowdness(dir: int = 1) -> void:
	crowdness_index = posmod(crowdness_index + dir, CROWDNESS_LEVELS.size())
	crowdness_changed.emit(get_crowdness_name())

func toggle_unlimited_turbo() -> void:
	unlimited_turbo = not unlimited_turbo
	cheats_changed.emit()

func toggle_unlimited_water() -> void:
	unlimited_water = not unlimited_water
	cheats_changed.emit()

func mat(hex_color: String, roughness: float = 0.55, transparent_alpha: float = 1.0, unshaded: bool = false) -> StandardMaterial3D:
	var key := "%s_%.2f_%.2f_%s" % [hex_color, roughness, transparent_alpha, str(unshaded)]
	if _std_mats.has(key):
		return _std_mats[key]
	var m := StandardMaterial3D.new()
	var c := Color(hex_color)
	c.a = transparent_alpha
	m.albedo_color = c
	m.set_meta("base_roughness", roughness)
	if transparent_alpha < 0.999:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if unshaded:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		_apply_shading_to_mat(m, roughness)
	_std_mats[key] = m
	return m

func _apply_shading_to_mat(m: StandardMaterial3D, base_roughness: float) -> void:
	if m.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED:
		return
	match shading_index:
		0: # Flat Low-Poly
			m.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
			m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
			m.roughness = 0.94
		1: # LEGO Glossy / Toon
			m.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
			m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
			m.roughness = clampf(base_roughness * 0.48, 0.14, 0.65)
			m.metallic_specular = 0.58
		2: # High (PBR + Glow)
			m.diffuse_mode = BaseMaterial3D.DIFFUSE_BURLEY
			m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
			m.roughness = clampf(base_roughness * 0.42, 0.12, 0.58)
			m.metallic_specular = 0.65

func _update_all_materials() -> void:
	for key in _std_mats.keys():
		var m: StandardMaterial3D = _std_mats[key]
		var base_r: float = float(m.get_meta("base_roughness", 0.55))
		_apply_shading_to_mat(m, base_r)
