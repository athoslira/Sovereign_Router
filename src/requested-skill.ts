export interface RequestedSkill { name: string; original: string; }

export function extractRequestedSkill(prompt: string): RequestedSkill | null {
	const match = prompt.match(/(?:\$|\buse(?:\s+(?:a|the|o|a))?\s+(?:skill\s+)?)((?:[a-z0-9][a-z0-9._-]*))/i)
		?? prompt.match(/\b(?:use|utilize)\s+(?:a\s+)?skill\s+["“']?([a-z0-9][a-z0-9._-]*)/i);
	if (!match?.[1]) return null;
	const name = match[1].toLowerCase();
	return { name, original: match[0] };
}
