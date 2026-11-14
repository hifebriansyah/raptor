class_name SkySpaceController
extends Node3D

signal island_discovered(island_name: String)

const SKY_DAY_TOP := Color("#3a96dd")
const SKY_DAY_HORIZON := Color("#d8f3fc")
const SKY_SPACE_TOP := Color("#03040a")
const SKY_SPACE_HORIZON := Color("#0d132a")

var world_env: WorldEnvironment = null
var sun_light: DirectionalLight3D = null
var fill_light: DirectionalLight3D = null

var _proc_sky_mat: ProceduralSkyMaterial = null
var _env: Environment = null
var _star_dome: Node3D = null
var _star_mats: Array[StandardMaterial3D] = []
var _planet_group: Node3D = null
var _planet_mat: StandardMaterial3D = null
var _ring_mat: StandardMaterial3D = null

var islands: Array[Dictionary] = [
	{"name": "Cloud Isle", "pos": Vector3(0.0, 170.0, -40.0), "r": 26.0, "discovered": false},
	{"name": "Crystal Star Isle", "pos": Vector3(180.0, 420.0, 60.0), "r": 20.0, "discovered": false},
	{"name": "Satellite Star Isle", "pos": Vector3(70.0, 470.0, 170.0), "r": 16.0, "discovered": false},
	{"name": "Moon Rock", "pos": Vector3(-130.0, 520.0, 30.0), "r": 30.0, "discovered": false},
]

func _ready() -> void:
	_setup_environment_and_sun()
	_build_stars_and_planet()
	_build_floating_islands()
	GameSettings.shading_changed.connect(_on_shading_changed)
	_on_shading_changed(GameSettings.get_shading_name())

func _setup_environment_and_sun() -> void:
	world_env = WorldEnvironment.new()
	_env = Environment.new()
	_proc_sky_mat = ProceduralSkyMaterial.new()
	_proc_sky_mat.sky_top_color = SKY_DAY_TOP
	_proc_sky_mat.sky_horizon_color = SKY_DAY_HORIZON
	_proc_sky_mat.ground_horizon_color = SKY_DAY_HORIZON
	_proc_sky_mat.ground_bottom_color = Color("#52b788")

	var sky := Sky.new()
	sky.sky_material = _proc_sky_mat
	_env.background_mode = Environment.BG_SKY
	_env.sky = sky
	_env.tonemap_mode = Environment.TONE_MAPPER_ACES
	_env.tonemap_exposure = 1.04
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	_env.ambient_light_sky_contribution = 0.35
	_env.ambient_light_energy = 0.58
	_env.fog_enabled = true
	_env.fog_light_color = SKY_DAY_HORIZON
	_env.fog_density = 0.00042
	_env.fog_sky_affect = 0.22
	world_env.environment = _env
	add_child(world_env)

	sun_light = DirectionalLight3D.new()
	sun_light.rotation_degrees = Vector3(-52.0, 35.0, 0.0)
	sun_light.light_color = Color("#fffcf2")
	sun_light.light_energy = 1.22
	sun_light.shadow_enabled = true
	sun_light.directional_shadow_max_distance = 175.0
	sun_light.shadow_bias = 0.03
	sun_light.shadow_normal_bias = 1.4
	add_child(sun_light)

	# Secondary sky-bounce fill light so shaded sides of LEGO City buildings & characters have crisp 3D depth
	fill_light = DirectionalLight3D.new()
	fill_light.rotation_degrees = Vector3(-42.0, -145.0, 0.0)
	fill_light.light_color = Color("#b8e0ff")
	fill_light.light_energy = 0.34
	fill_light.shadow_enabled = false
	add_child(fill_light)

func _on_shading_changed(_mode: String) -> void:
	if sun_light == null or _env == null:
		return
	match GameSettings.shading_index:
		0: # Flat Low-Poly
			sun_light.shadow_enabled = false
			_env.glow_enabled = false
		1: # LEGO Glossy / Toon
			sun_light.shadow_enabled = true
			_env.glow_enabled = false
		2: # High (PBR + Glow)
			sun_light.shadow_enabled = true
			_env.glow_enabled = true
			_env.glow_intensity = 0.48
			_env.glow_bloom = 0.12

func _build_stars_and_planet() -> void:
	_star_dome = Node3D.new()
	add_child(_star_dome)
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242

	# 3 star brightness groups so all stars fade smoothly without per-star material overhead
	for b in range(3):
		var sm := StandardMaterial3D.new()
		sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		sm.albedo_color = Color(1.0, 0.98, 1.0, 0.0)
		_star_mats.append(sm)

	var star_box := BoxMesh.new()
	star_box.size = Vector3(4.5, 4.5, 4.5)

	for i in range(280):
		var u := rng.randf_range(-0.15, 1.0)
		var ang := rng.randf_range(0.0, TAU)
		var s := sqrt(maxf(0.0, 1.0 - u * u))
		var dist := 1350.0
		var mi := MeshInstance3D.new()
		mi.mesh = star_box
		mi.position = Vector3(cos(ang) * s * dist, u * dist, sin(ang) * s * dist)
		mi.material_override = _star_mats[i % _star_mats.size()]
		_star_dome.add_child(mi)

	# Ringed planet high in space
	_planet_group = Node3D.new()
	_planet_group.position = Vector3(-900.0, 780.0, -1100.0)
	add_child(_planet_group)

	_planet_mat = StandardMaterial3D.new()
	_planet_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_planet_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_planet_mat.albedo_color = Color(0.70, 0.53, 1.0, 0.0)

	var p_mesh := SphereMesh.new()
	p_mesh.radius = 155.0
	p_mesh.height = 310.0
	var p_inst := MeshInstance3D.new()
	p_inst.mesh = p_mesh
	p_inst.material_override = _planet_mat
	_planet_group.add_child(p_inst)

	_ring_mat = StandardMaterial3D.new()
	_ring_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_ring_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_ring_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_ring_mat.albedo_color = Color(1.0, 0.84, 0.65, 0.0)

	var ring_mesh := CylinderMesh.new()
	ring_mesh.top_radius = 275.0
	ring_mesh.bottom_radius = 275.0
	ring_mesh.height = 2.0
	var r_inst := MeshInstance3D.new()
	r_inst.mesh = ring_mesh
	r_inst.rotation_degrees = Vector3(24.0, 0.0, -16.0)
	r_inst.material_override = _ring_mat
	_planet_group.add_child(r_inst)

func _build_floating_islands() -> void:
	for isl in islands:
		var pos: Vector3 = isl["pos"]
		var r: float = isl["r"]
		var in_space := pos.y >= WorldTerrain.SPACE_Y
		var is_moon: bool = isl["name"] == "Moon Rock"
		var top_col := "#b8bcc6" if is_moon else ("#7b6cff" if in_space else "#8ccf6a")
		var under_col := "#6c757d" if is_moon else ("#3d3466" if in_space else "#8d6e63")

		var root := Node3D.new()
		root.position = pos
		add_child(root)

		# Walkable top disk
		var sb := StaticBody3D.new()
		sb.position = Vector3(0.0, -0.8, 0.0)
		var top_mi := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = r
		cyl.bottom_radius = r * 0.92
		cyl.height = 1.6
		cyl.radial_segments = 24
		top_mi.mesh = cyl
		top_mi.material_override = GameSettings.mat(top_col)
		sb.add_child(top_mi)

		var cs := CollisionShape3D.new()
		var cshape := CylinderShape3D.new()
		cshape.radius = r
		cshape.height = 1.6
		cs.shape = cshape
		sb.add_child(cs)
		root.add_child(sb)

		# Inverted rocky underside cone
		var cone_mi := MeshInstance3D.new()
		var cone := CylinderMesh.new()
		cone.top_radius = r * 0.90
		cone.bottom_radius = 1.8
		cone.height = r * 1.25
		cone.radial_segments = 14
		cone_mi.mesh = cone
		cone_mi.position = Vector3(0.0, -1.6 - r * 0.62, 0.0)
		cone_mi.material_override = GameSettings.mat(under_col)
		root.add_child(cone_mi)

		# Landmarks per island
		if isl["name"] == "Cloud Isle":
			for i in range(6):
				var ang := float(i) * TAU / 6.0
				var col_mi := MeshInstance3D.new()
				var col_cyl := CylinderMesh.new()
				col_cyl.top_radius = 0.75
				col_cyl.bottom_radius = 0.85
				col_cyl.height = 5.2
				col_mi.mesh = col_cyl
				col_mi.position = Vector3(cos(ang) * 9.0, 2.6, sin(ang) * 9.0)
				col_mi.material_override = GameSettings.mat("#f1ece2")
				root.add_child(col_mi)
		elif is_moon:
			var pole := MeshInstance3D.new()
			var p_cyl := CylinderMesh.new()
			p_cyl.top_radius = 0.1
			p_cyl.bottom_radius = 0.1
			p_cyl.height = 5.0
			pole.mesh = p_cyl
			pole.position = Vector3(0.0, 2.5, 0.0)
			pole.material_override = GameSettings.mat("#f8f9fa")
			root.add_child(pole)

			var flag := MeshInstance3D.new()
			var f_box := BoxMesh.new()
			f_box.size = Vector3(2.2, 1.3, 0.1)
			flag.mesh = f_box
			flag.position = Vector3(1.1, 4.3, 0.0)
			flag.material_override = GameSettings.mat("#ffbe0b", 0.4, 1.0, true)
			root.add_child(flag)
		else:
			for i in range(5):
				var ang := float(i) * TAU / 5.0
				var cr := MeshInstance3D.new()
				var cr_m := CylinderMesh.new()
				cr_m.top_radius = 0.15
				cr_m.bottom_radius = 1.1
				cr_m.height = 4.2
				cr.mesh = cr_m
				cr.position = Vector3(cos(ang) * 7.5, 2.1, sin(ang) * 7.5)
				cr.material_override = GameSettings.mat("#00f5d4", 0.2, 0.9, true)
				root.add_child(cr)

func update_altitude(cam_pos: Vector3, player_pos: Vector3, delta: float) -> void:
	# Smooth continuous Land <-> Space transition between y = 110 m and y = 340 m (no sudden pop!)
	var space_t := smoothstep(110.0, 340.0, cam_pos.y)

	if _proc_sky_mat != null:
		_proc_sky_mat.sky_top_color = SKY_DAY_TOP.lerp(SKY_SPACE_TOP, space_t)
		_proc_sky_mat.sky_horizon_color = SKY_DAY_HORIZON.lerp(SKY_SPACE_HORIZON, space_t)
		_proc_sky_mat.ground_horizon_color = SKY_DAY_HORIZON.lerp(SKY_SPACE_HORIZON, space_t)
		_proc_sky_mat.ground_bottom_color = Color("#52b788").lerp(SKY_SPACE_TOP, space_t)

	if _env != null:
		_env.fog_light_color = SKY_DAY_HORIZON.lerp(SKY_SPACE_HORIZON, space_t)
		_env.fog_density = lerpf(0.00042, 0.00008, space_t)

	if _star_dome != null:
		_star_dome.position = Vector3(cam_pos.x, 0.0, cam_pos.z)
		_star_dome.rotate_y(delta * 0.012)
		for i in range(_star_mats.size()):
			var base_a := 0.95 - float(i) * 0.2
			_star_mats[i].albedo_color.a = clampf(space_t * base_a, 0.0, 1.0)

	if _planet_mat != null and _ring_mat != null:
		_planet_mat.albedo_color.a = space_t * 0.95
		_ring_mat.albedo_color.a = space_t * 0.72
		_planet_group.rotate_y(delta * 0.04)

	# Check floating island discovery (+25 Lab Points)
	for isl in islands:
		if not isl["discovered"]:
			var ipos: Vector3 = isl["pos"]
			var ir: float = isl["r"]
			if absf(player_pos.y - ipos.y) < 4.5 and Vector2(player_pos.x - ipos.x, player_pos.z - ipos.z).length() <= ir:
				isl["discovered"] = true
				GameSettings.lab_points += 25
				island_discovered.emit(String(isl["name"]))
