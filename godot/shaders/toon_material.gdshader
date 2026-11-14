shader_type spatial;
render_mode diffuse_toon, specular_toon;

uniform vec4 albedo_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float roughness : hint_range(0.0, 1.0) = 0.65;
uniform float rim_strength : hint_range(0.0, 1.0) = 0.28;

void fragment() {
	ALBEDO = albedo_color.rgb;
	ALPHA = albedo_color.a;
	ROUGHNESS = roughness;
	SPECULAR = 0.25;
	RIM = rim_strength;
	RIM_TINT = 0.5;
}
