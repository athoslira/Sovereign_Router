export type VideoEngine = 'remotion' | 'manim';

const VIDEO_REQUEST = /\b(?:create|generate|render|produce|make|crie|gere|renderize|produza|fa[çc]a)\b[\s\S]{0,80}\b(?:video|vídeo|mp4|prores|animation|anima[çc][aã]o|reel|reels|tiktok|shorts|remotion|manim)\b|\b(?:video|vídeo|mp4|prores|animation|anima[çc][aã]o|reel|reels|tiktok|shorts)\b[\s\S]{0,80}\b(?:with|using|com|usando)\b[\s\S]{0,40}\b(?:remotion|manim)\b/i;
const MATH_SUBJECT = /\b(?:math|matem[aá]tica|equation|equa[çc][aã]o|calculus|c[aá]lculo|geometry|geometria|physics|f[ií]sica|proof|demonstra[çc][aã]o|graph|gr[aá]fico)\b/i;
const SOCIAL_TARGET = /\b(?:tiktok|reels?|shorts?|vertical|9\s*[:x]\s*16)\b/i;

export function isVideoRequest(prompt: string): boolean {
	return VIDEO_REQUEST.test(prompt);
}

export function selectVideoEngine(prompt: string): VideoEngine {
	return MATH_SUBJECT.test(prompt) ? 'manim' : 'remotion';
}

export function videoSkillHint(prompt: string): string {
	if (selectVideoEngine(prompt) === 'manim') return 'manim';
	return SOCIAL_TARGET.test(prompt) ? 'short-form-video' : 'explainer-video';
}

export function videoAuthoringInstruction(outputRoot: string, prompt: string): string {
	const engine = selectVideoEngine(prompt);
	const skill = videoSkillHint(prompt);
	const engineGuidance = engine === 'manim'
		? 'Use Manim Community Edition for the programmatic scene. Prefer explicit objects, deterministic timing, and inspect representative frames before the final render.'
		: 'Use Remotion with a registered Composition, typed props/default props, and frame-driven timing. Keep visual assets and captions inside the project rather than relying on browser-time external fetches.';
	return `This is a programmatic video request. Use the installed Hermes skill "${skill}" if available. ${engineGuidance} Work only inside an Agent Kernel-approved workspace. The intended vault-relative delivery root is ${outputRoot}, but do not write there unless that location is also available to the approved Hermes workspace. First produce a concise creative brief and a scene/timing plan. Then create editable source, render a low-cost representative still or short preview, verify timing, captions, readability, and media references, and request/observe approval for any terminal or render action. Only after verification, render the requested final file (MP4 unless the user requests another format). Return the output path, source-project path, engine used, format/resolution/fps, and a short verification summary. Never claim a video was rendered unless the approved runtime completed it.`;
}
