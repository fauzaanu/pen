import {requestUrl, RequestUrlParam} from "obsidian";
import {FrontmatterField} from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview";

export const DEFAULT_SYSTEM_PROMPT = `You are a research assistant inside a note-taking app. The user gives you a topic (the note title) and optionally existing notes. Your job is to research and expand on the topic with well-structured markdown content.

Rules:
- Do NOT start with a heading. The note already has its title as a heading.
- Start directly with an introductory paragraph.
- After the intro, use headings (## level and below) to organize deeper sections.
- Be thorough, factual, and organized.
- Use bullet points and links where appropriate.
- Do not repeat content that already exists in the note. Build on what's there.
- For frontmatter fields (prefixed with fm_), provide concise values appropriate to the field name.`;

export const DEFAULT_IMAGE_PROMPT = `Generate a high-quality image based on the following description. The image should be visually clear, well-composed, and suitable for embedding in a note.

Description: {{selection}}`;

const FM_PREFIX = "fm_";

function buildSchema(fields: FrontmatterField[]): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		content: {
			type: "string",
			description: "The research content in markdown. Do NOT start with a heading — the note title is already present. Start with an introductory paragraph, then use ## headings for subsections.",
		},
	};
	const required = new Set<string>(["content"]);

	for (const field of fields) {
		const key = FM_PREFIX + field.name;
		if (key in properties) continue;
		if (field.type === "list") {
			properties[key] = {
				type: "array",
				items: {type: "string"},
				description: `List of values for the "${field.name}" frontmatter field. Use lowercase with hyphens instead of spaces (e.g. "machine-learning" not "Machine Learning").`,
			};
		} else {
			properties[key] = {
				type: "string",
				description: `Value for the "${field.name}" frontmatter field.`,
			};
		}
		required.add(key);
	}

	return {type: "object", properties, required: [...required]};
}

export interface ResearchResult {
	content: string;
	frontmatter: Record<string, string | string[]>;
}

function parseResult(raw: Record<string, unknown>, fields: FrontmatterField[]): ResearchResult {
	const frontmatter: Record<string, string | string[]> = {};
	for (const field of fields) {
		const key = FM_PREFIX + field.name;
		if (key in raw) {
			frontmatter[field.name] = raw[key] as string | string[];
		}
	}

	// Gemini's JSON mode sometimes double-escapes newlines, producing literal
	// "\n" (two chars) instead of real newline characters. Replace them.
	const content = (raw.content as string).replace(/\\n/g, "\n");

	return {
		content,
		frontmatter,
	};
}

export async function research(
	noteTitle: string,
	existingContent: string,
	apiKey: string,
	useWebSearch: boolean,
	frontmatterFields: FrontmatterField[],
	userRules: string,
	systemPrompt: string,
): Promise<ResearchResult> {
	if (!apiKey || apiKey.trim() === "") {
		throw new Error("Gemini API key is not set. Go to plugin settings to add it.");
	}

	let userMessage = `Topic: ${noteTitle}`;
	if (existingContent.trim()) {
		userMessage += `\n\nExisting notes:\n${existingContent}`;
	}

	const body: Record<string, unknown> = {
		system_instruction: {
			parts: [{text: userRules.trim() ? systemPrompt + "\n\nUser rules:\n" + userRules : systemPrompt}],
		},
		contents: [
			{role: "user", parts: [{text: userMessage}]},
		],
		generationConfig: {
			responseMimeType: "application/json",
			responseJsonSchema: buildSchema(frontmatterFields),
		},
	};

	if (useWebSearch) {
		body.tools = [{google_search: {}}];
	}

	const url = `${GEMINI_BASE}:generateContent?key=${apiKey}`;
	const options: RequestUrlParam = {
		method: "POST",
		url,
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
		throw: false,
	};

	try {
		const response = await requestUrl(options);
		const json = response.json;

		if (response.status !== 200) {
			const errMsg = json?.error?.message || JSON.stringify(json).substring(0, 300);
			throw new Error(`Gemini ${response.status}: ${errMsg}`);
		}

		if (json?.error) {
			throw new Error(`Gemini API error: ${json.error.message || JSON.stringify(json.error)}`);
		}

		const candidate = json?.candidates?.[0];
		if (!candidate) {
			throw new Error(`No candidates in response: ${JSON.stringify(json).substring(0, 500)}`);
		}

		const text = candidate.content?.parts?.[0]?.text;
		if (!text) {
			throw new Error(`No text in response: ${JSON.stringify(candidate).substring(0, 500)}`);
		}

		const raw = JSON.parse(text) as Record<string, unknown>;
		return parseResult(raw, frontmatterFields);
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error(`Research failed: ${error}`);
	}
}

const NANO_BANANA_MODEL = "gemini-3.1-flash-image-preview";
const NANO_BANANA_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_BANANA_MODEL}`;

export async function generateImage(
	prompt: string,
	apiKey: string,
): Promise<{base64: string; mimeType: string}> {
	if (!apiKey || apiKey.trim() === "") {
		throw new Error("Gemini API key is not set. Go to plugin settings to add it.");
	}

	const body = {
		contents: [{parts: [{text: prompt}]}],
	};

	const url = `${NANO_BANANA_BASE}:generateContent`;
	const options: RequestUrlParam = {
		method: "POST",
		url,
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify(body),
		throw: false,
	};

	const response = await requestUrl(options);
	const json = response.json;

	if (response.status !== 200) {
		const errMsg = json?.error?.message || JSON.stringify(json).substring(0, 300);
		throw new Error(`Nano Banana ${response.status}: ${errMsg}`);
	}

	const candidate = json?.candidates?.[0];
	if (!candidate) {
		throw new Error(`No candidates in response: ${JSON.stringify(json).substring(0, 500)}`);
	}

	const parts = candidate.content?.parts;
	if (!parts || parts.length === 0) {
		throw new Error(`No parts in response: ${JSON.stringify(candidate).substring(0, 500)}`);
	}

	// Skip thought parts, find the actual output image
	for (const part of parts) {
		if (part.thought) continue;
		const inlineData = part.inlineData || part.inline_data;
		if (inlineData && inlineData.data) {
			return {
				base64: inlineData.data,
				mimeType: inlineData.mimeType || inlineData.mime_type || "image/png",
			};
		}
	}

	const partSummary = parts.map((p: Record<string, unknown>) => Object.keys(p).join(",")).join(" | ");
	throw new Error(`No image in response. Parts contained: [${partSummary}]`);
}

