class_name WorldActor
extends CharacterBody3D

var actor_kind: String = "car" # "car", "boat", "npc", "family"
var actor_name: String = ""
var actor_role: String = ""
var dialogue_line: String = ""
var portrait_color: String = "#4cc9f0"

var road_axis: String = "x" # "x" or "z"
var road_coord: float = 0.0
var lane_offset: float = 2.5
var move_dir: float = 1.0
var cruise_speed: float = 11.0
var boat_center := Vector2(390.0, -30.0)
var boat_radius: float = 65.0
var boat_angle: float = 0.0

var flung: bool = false
var stun_timer: float = 0.0
var driver_Frees: bool = false
var player_driving: bool = false
var driver_visual: Node3D = null
var seat_node: Node3D = null

func apply_raptor_hit(push_dir: Vector3, hit_speed: float, is_ramming: bool) -> void:
	if actor_kind == "family":
		# Family members (Wife in Godzilla suit, two sons, Grandma) are never flung!
		return
	var dir := push_dir.normalized() if push_dir.length() > 0.01 else Vector3(1.0, 0.0, 0.0)
	if is_ramming or hit_speed > 19.0:
		flung = true
		stun_timer = 2.8
		velocity = dir * clampf(hit_speed * 0.85, 14.0, 38.0) + Vector3(0.0, clampf(hit_speed * 0.45, 9.0, 22.0), 0.0)
	else:
		# Solid non-ghost bump: push the vehicle/NPC back and briefly brake it
		stun_timer = 0.85
		velocity = dir * clampf(hit_speed * 0.55, 4.0, 11.0)
		move_and_slide()
