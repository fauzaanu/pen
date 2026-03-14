import {App, Modal, Notice, PluginSettingTab, Setting} from "obsidian";
import {FrontmatterField, Profile, ResearchSettings} from "./types";
import ResearchPlugin from "../main";
import {DEFAULT_SYSTEM_PROMPT, DEFAULT_IMAGE_PROMPT, DEFAULT_MODEL_NAME, DEFAULT_IMAGE_MODEL_NAME} from "./api_calls";

export const DEFAULT_SETTINGS: ResearchSettings = {
	apiKey: "",
	modelName: DEFAULT_MODEL_NAME,
	imageModelName: DEFAULT_IMAGE_MODEL_NAME,
	profiles: [
		{
			name: "Default",
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			imagePrompt: DEFAULT_IMAGE_PROMPT,
			userRules: "",
			frontmatterFields: [],
		},
	],
	activeProfileName: "Default",
};

/**
 * Pure migration function: converts raw persisted data into ResearchSettings.
 * If the data has no `profiles` array, it wraps legacy top-level fields into a "Default" profile.
 * If the data already has a `profiles` array, it preserves them as-is.
 */
export function migrateSettings(data: Record<string, unknown>): ResearchSettings {
	if (!Array.isArray(data.profiles)) {
		const migrated: Profile = {
			name: "Default",
			systemPrompt: (data.systemPrompt as string) ?? DEFAULT_SYSTEM_PROMPT,
			imagePrompt: (data.imagePrompt as string) ?? DEFAULT_IMAGE_PROMPT,
			userRules: (data.userRules as string) ?? "",
			frontmatterFields: (data.frontmatterFields as FrontmatterField[]) ?? [],
		};
		return {
			apiKey: (data.apiKey as string) ?? "",
			modelName: (data.modelName as string) ?? DEFAULT_MODEL_NAME,
			imageModelName: (data.imageModelName as string) ?? DEFAULT_IMAGE_MODEL_NAME,
			profiles: [migrated],
			activeProfileName: "Default",
		};
	}
	return {
		apiKey: (data.apiKey as string) ?? "",
		modelName: (data.modelName as string) ?? DEFAULT_MODEL_NAME,
		imageModelName: (data.imageModelName as string) ?? DEFAULT_IMAGE_MODEL_NAME,
		profiles: data.profiles as Profile[],
		activeProfileName: (data.activeProfileName as string) ?? (data.profiles as Profile[])[0]?.name ?? "Default",
	};
}

export class ProfileManager {
	constructor(private settings: ResearchSettings, private save: () => Promise<void>) {}

	getActiveProfile(): Profile {
		const profile = this.settings.profiles.find(p => p.name === this.settings.activeProfileName);
		if (profile) return profile;
		// Fall back to first profile if activeProfileName is stale
		return this.settings.profiles[0];
	}

	async create(name: string): Promise<Profile> {
		if (!name || !name.trim()) {
			throw new Error("Profile name cannot be empty.");
		}
		const trimmed = name.trim();
		if (this.settings.profiles.some(p => p.name === trimmed)) {
			throw new Error(`A profile named '${trimmed}' already exists.`);
		}
		const profile: Profile = {
			name: trimmed,
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			imagePrompt: DEFAULT_IMAGE_PROMPT,
			userRules: "",
			frontmatterFields: [],
		};
		this.settings.profiles.push(profile);
		await this.save();
		return profile;
	}

	async switchTo(name: string): Promise<void> {
		this.settings.activeProfileName = name;
		await this.save();
	}

	async deleteActive(): Promise<void> {
		if (this.settings.profiles.length <= 1) {
			throw new Error("Cannot delete the only remaining profile.");
		}
		const idx = this.settings.profiles.findIndex(p => p.name === this.settings.activeProfileName);
		if (idx !== -1) {
			this.settings.profiles.splice(idx, 1);
		}
		this.settings.activeProfileName = this.settings.profiles[0].name;
		await this.save();
	}

	async renameActive(newName: string): Promise<void> {
		if (!newName || !newName.trim()) {
			throw new Error("Profile name cannot be empty.");
		}
		const trimmed = newName.trim();
		if (this.settings.profiles.some(p => p.name === trimmed)) {
			throw new Error(`A profile named '${trimmed}' already exists.`);
		}
		const profile = this.getActiveProfile();
		profile.name = trimmed;
		this.settings.activeProfileName = trimmed;
		await this.save();
	}

	async duplicateActive(): Promise<Profile> {
		const active = this.getActiveProfile();
		const newName = this.generateDuplicateName(active.name);
		const duplicate: Profile = {
			name: newName,
			systemPrompt: active.systemPrompt,
			imagePrompt: active.imagePrompt,
			userRules: active.userRules,
			frontmatterFields: active.frontmatterFields.map(f => ({...f})),
		};
		this.settings.profiles.push(duplicate);
		this.settings.activeProfileName = newName;
		await this.save();
		return duplicate;
	}

	private generateDuplicateName(baseName: string): string {
		const candidate = `${baseName} (Copy)`;
		if (!this.settings.profiles.some(p => p.name === candidate)) return candidate;
		let i = 2;
		while (this.settings.profiles.some(p => p.name === `${baseName} (Copy ${i})`)) i++;
		return `${baseName} (Copy ${i})`;
	}

	async saveActiveProfile(): Promise<void> {
		await this.save();
	}
}


class TextInputModal extends Modal {
	private value = "";
	private resolve: (value: string | null) => void;

	constructor(app: App, private title: string, private placeholder: string, private defaultValue = "") {
		super(app);
		this.resolve = () => {};
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl("h3", {text: this.title});
		const input = contentEl.createEl("input", {type: "text"});
		input.placeholder = this.placeholder;
		input.value = this.defaultValue;
		input.style.width = "100%";
		input.style.marginBottom = "1em";
		input.addEventListener("input", () => { this.value = input.value; });
		this.value = this.defaultValue;

		const btnContainer = contentEl.createDiv({cls: "modal-button-container"});
		const submitBtn = btnContainer.createEl("button", {text: "OK", cls: "mod-cta"});
		submitBtn.addEventListener("click", () => { this.resolve(this.value); this.close(); });
		const cancelBtn = btnContainer.createEl("button", {text: "Cancel"});
		cancelBtn.addEventListener("click", () => { this.resolve(null); this.close(); });

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { this.resolve(this.value); this.close(); }
		});
		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}

	openAndGetValue(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}
}

export class ResearchSettingTab extends PluginSettingTab {
	plugin: ResearchPlugin;
	private activeTab: "config" | "profiles" | "content" | "image" = "config";

	constructor(app: App, plugin: ResearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// ── Tab bar ──────────────────────────────────────────────
		const tabBar = containerEl.createDiv({cls: "research-settings-tabs"});
		tabBar.style.display = "flex";
		tabBar.style.gap = "0";
		tabBar.style.borderBottom = "1px solid var(--background-modifier-border)";
		tabBar.style.marginBottom = "1em";

		const tabs: {id: "config" | "profiles" | "content" | "image"; label: string}[] = [
			{id: "config", label: "Config"},
			{id: "profiles", label: "Profiles"},
			{id: "content", label: "Content Generation"},
			{id: "image", label: "Image Generation"},
		];

		for (const tab of tabs) {
			const btn = tabBar.createEl("button", {text: tab.label});
			btn.style.padding = "8px 16px";
			btn.style.border = "none";
			btn.style.background = "none";
			btn.style.cursor = "pointer";
			btn.style.borderBottom = tab.id === this.activeTab
				? "2px solid var(--interactive-accent)"
				: "2px solid transparent";
			btn.style.color = tab.id === this.activeTab
				? "var(--text-normal)"
				: "var(--text-muted)";
			btn.style.fontWeight = tab.id === this.activeTab ? "600" : "400";
			btn.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		// ── Tab content ──────────────────────────────────────────
		switch (this.activeTab) {
			case "config":
				this.displayConfigTab(containerEl);
				break;
			case "profiles":
				this.displayProfilesTab(containerEl);
				break;
			case "content":
				this.displayContentTab(containerEl);
				break;
			case "image":
				this.displayImageTab(containerEl);
				break;
		}
	}

	/** Helper to make a Setting's textarea span full width below the label. */
	private makeFullWidth(settingEl: Setting): void {
		settingEl.settingEl.style.display = "block";
	}

	private displayConfigTab(containerEl: HTMLElement): void {
		// ── API Key (masked) ─────────────────────────────────────
		new Setting(containerEl).setName("API").setHeading();

		const apiKeySetting = new Setting(containerEl)
			.setName("Gemini API key")
			.setDesc("Get your key from Google AI Studio. Used for both research and image generation.");

		const apiKeyInput = apiKeySetting.controlEl.createEl("input", {type: "password"});
		apiKeyInput.placeholder = "Enter your Gemini API key";
		apiKeyInput.value = this.plugin.settings.apiKey;
		apiKeyInput.style.width = "100%";
		apiKeyInput.style.minWidth = "200px";
		apiKeyInput.addEventListener("input", async () => {
			this.plugin.settings.apiKey = apiKeyInput.value;
			await this.plugin.saveSettings();
		});

		const toggleBtn = apiKeySetting.controlEl.createEl("button", {
			cls: "clickable-icon",
			attr: {"aria-label": "Toggle API key visibility"},
		});
		toggleBtn.style.marginLeft = "4px";
		toggleBtn.textContent = "👁";
		toggleBtn.addEventListener("click", () => {
			const isPassword = apiKeyInput.type === "password";
			apiKeyInput.type = isPassword ? "text" : "password";
			toggleBtn.textContent = isPassword ? "🙈" : "👁";
		});

		// ── Models ───────────────────────────────────────────────
		new Setting(containerEl).setName("Models").setHeading();

		new Setting(containerEl)
			.setName("Research model")
			.setDesc("Gemini model name used for content generation.")
			.addText(text => text
				.setPlaceholder(DEFAULT_MODEL_NAME)
				.setValue(this.plugin.settings.modelName)
				.onChange(async (value) => {
					this.plugin.settings.modelName = value.trim() || DEFAULT_MODEL_NAME;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Image model")
			.setDesc("Gemini model name used for image generation.")
			.addText(text => text
				.setPlaceholder(DEFAULT_IMAGE_MODEL_NAME)
				.setValue(this.plugin.settings.imageModelName)
				.onChange(async (value) => {
					this.plugin.settings.imageModelName = value.trim() || DEFAULT_IMAGE_MODEL_NAME;
					await this.plugin.saveSettings();
				}));
	}

	private displayProfilesTab(containerEl: HTMLElement): void {
		const manager = this.plugin.profileManager;

		new Setting(containerEl).setName("Profiles").setHeading();

		const profileSetting = new Setting(containerEl)
			.setName("Active profile")
			.setDesc("Switch between saved prompt configurations.")
			.addDropdown(dropdown => {
				for (const profile of this.plugin.settings.profiles) {
					dropdown.addOption(profile.name, profile.name);
				}
				dropdown.setValue(this.plugin.settings.activeProfileName);
				dropdown.onChange(async (value) => {
					try {
						await manager.switchTo(value);
						this.display();
					} catch (e) {
						new Notice(e instanceof Error ? e.message : "Failed to switch profile.");
					}
				});
			});

		profileSetting.addButton(button => button
			.setButtonText("New")
			.setTooltip("Create a new profile")
			.onClick(async () => {
				const modal = new TextInputModal(this.app, "New profile", "Profile name");
				const name = await modal.openAndGetValue();
				if (name === null) return;
				try {
					await manager.create(name);
					this.display();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : "Failed to create profile.");
				}
			}));

		profileSetting.addButton(button => button
			.setButtonText("Rename")
			.setTooltip("Rename the active profile")
			.onClick(async () => {
				const current = manager.getActiveProfile();
				const modal = new TextInputModal(this.app, "Rename profile", "New name", current.name);
				const newName = await modal.openAndGetValue();
				if (newName === null) return;
				try {
					await manager.renameActive(newName);
					this.display();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : "Failed to rename profile.");
				}
			}));

		profileSetting.addButton(button => button
			.setButtonText("Duplicate")
			.setTooltip("Duplicate the active profile")
			.onClick(async () => {
				try {
					await manager.duplicateActive();
					this.display();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : "Failed to duplicate profile.");
				}
			}));

		profileSetting.addButton(button => button
			.setButtonText("Delete")
			.setTooltip("Delete the active profile")
			.setWarning()
			.onClick(async () => {
				try {
					await manager.deleteActive();
					this.display();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : "Failed to delete profile.");
				}
			}));
	}

	private displayContentTab(containerEl: HTMLElement): void {
		const manager = this.plugin.profileManager;

		// ── Research prompts ─────────────────────────────────────
		new Setting(containerEl).setName("Research").setHeading();

		const systemPromptSetting = new Setting(containerEl)
			.setName("System prompt")
			.setDesc("The base prompt sent to the research model.")
			.addTextArea(text => {
				text
					.setValue(manager.getActiveProfile().systemPrompt)
					.onChange(async (value) => {
						manager.getActiveProfile().systemPrompt = value;
						await manager.saveActiveProfile();
					});
				text.inputEl.rows = 10;
				text.inputEl.style.width = "100%";
			});
		this.makeFullWidth(systemPromptSetting);

		new Setting(containerEl)
			.setName("Reset research prompt")
			.setDesc("Restore the research system prompt to its default.")
			.addButton(button => button
				.setButtonText("Reset to default")
				.onClick(async () => {
					manager.getActiveProfile().systemPrompt = DEFAULT_SYSTEM_PROMPT;
					await manager.saveActiveProfile();
					this.display();
				}));

		const rulesSetting = new Setting(containerEl)
			.setName("Custom rules")
			.setDesc("Additional instructions appended to the research prompt.")
			.addTextArea(text => {
				text
					.setPlaceholder("e.g. Always write in Spanish. Focus on practical examples.")
					.setValue(manager.getActiveProfile().userRules)
					.onChange(async (value) => {
						manager.getActiveProfile().userRules = value;
						await manager.saveActiveProfile();
					});
				text.inputEl.rows = 4;
				text.inputEl.style.width = "100%";
			});
		this.makeFullWidth(rulesSetting);

		// ── Frontmatter fields ──────────────────────────────────
		new Setting(containerEl).setName("Frontmatter fields").setHeading();

		let newFieldName = "";
		let newFieldType: "text" | "list" = "text";

		new Setting(containerEl)
			.setName("Add field")
			.setDesc("Add a frontmatter field for research output. Use 'list' for fields like tags.")
			.addText(text => {
				text.setPlaceholder("Field name");
				text.onChange(value => { newFieldName = value; });
			})
			.addDropdown(dropdown => {
				dropdown
					.addOption("text", "text")
					.addOption("list", "list")
					.setValue("text")
					.onChange(value => { newFieldType = value as "text" | "list"; });
			})
			.addButton(button => button
				.setButtonText("Add")
				.onClick(async () => {
					const name = newFieldName.trim();
					const activeProfile = manager.getActiveProfile();
					if (name && !activeProfile.frontmatterFields.some((f: FrontmatterField) => f.name === name)) {
						activeProfile.frontmatterFields.push({name, type: newFieldType});
						await manager.saveActiveProfile();
						this.display();
					}
				}));

		for (const field of manager.getActiveProfile().frontmatterFields) {
			new Setting(containerEl)
				.setName(`${field.name} (${field.type})`)
				.addExtraButton(button => button
					.setIcon("trash")
					.setTooltip("Remove field")
					.onClick(async () => {
						const activeProfile = manager.getActiveProfile();
						activeProfile.frontmatterFields =
							activeProfile.frontmatterFields.filter((f: FrontmatterField) => f.name !== field.name);
						await manager.saveActiveProfile();
						this.display();
					}));
		}
	}

	private displayImageTab(containerEl: HTMLElement): void {
		const manager = this.plugin.profileManager;

		new Setting(containerEl).setName("Image generation").setHeading();

		const imagePromptSetting = new Setting(containerEl)
			.setName("Image prompt")
			.setDesc("Prompt template for image generation. Use {{selection}} as a placeholder for the selected text.")
			.addTextArea(text => {
				text
					.setValue(manager.getActiveProfile().imagePrompt)
					.onChange(async (value) => {
						manager.getActiveProfile().imagePrompt = value;
						await manager.saveActiveProfile();
					});
				text.inputEl.rows = 6;
				text.inputEl.style.width = "100%";
			});
		this.makeFullWidth(imagePromptSetting);

		new Setting(containerEl)
			.setName("Reset image prompt")
			.setDesc("Restore the image prompt to its default.")
			.addButton(button => button
				.setButtonText("Reset to default")
				.onClick(async () => {
					manager.getActiveProfile().imagePrompt = DEFAULT_IMAGE_PROMPT;
					await manager.saveActiveProfile();
					this.display();
				}));
	}
}
