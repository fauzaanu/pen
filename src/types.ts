export interface FrontmatterField {
	name: string;
	type: "text" | "list";
}

export interface Profile {
	name: string;
	systemPrompt: string;
	imagePrompt: string;
	userRules: string;
	frontmatterFields: FrontmatterField[];
}

export interface ResearchSettings {
	apiKey: string;
	modelName: string;
	imageModelName: string;
	profiles: Profile[];
	activeProfileName: string;
}
