import {Editor, MarkdownView, Notice, Plugin} from "obsidian";
import {ResearchSettings} from "./src/types";
import {DEFAULT_SETTINGS, ResearchSettingTab, ProfileManager, migrateSettings} from "./src/settings";
import {research, ResearchResult, generateImage} from "./src/api_calls";
import {removeEmptyLines} from "./src/helpers";

export default class ResearchPlugin extends Plugin {
	settings: ResearchSettings;
	profileManager: ProfileManager;
	statusBarEl: HTMLElement;
	private activeResearchCount = 0;
	private activeImageCount = 0;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ResearchSettingTab(this.app, this));
		this.statusBarEl = this.addStatusBarItem();

		this.addCommand({
			id: "research",
			name: "Research",
			hotkeys: [{modifiers: ["Alt"], key: "q"}],
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runResearch(editor, view, false);
			},
		});

		this.addCommand({
			id: "research-web",
			name: "Research with web search",
			hotkeys: [{modifiers: ["Alt"], key: "w"}],
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runResearch(editor, view, true);
			},
		});

		this.addCommand({
			id: "generate-image",
			name: "Generate image from selected text",
			hotkeys: [{modifiers: ["Alt"], key: "x"}],
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runGenerateImage(editor, view);
			},
		});
	}

	private updateStatusBar(): void {
		const parts: string[] = [];
		if (this.activeResearchCount > 0) {
			parts.push(this.activeResearchCount === 1
				? "🔍 Researching..."
				: `🔍 Researching ${this.activeResearchCount} notes...`);
		}
		if (this.activeImageCount > 0) {
			parts.push(this.activeImageCount === 1
				? "🎨 Generating image..."
				: `🎨 Generating ${this.activeImageCount} images...`);
		}
		this.statusBarEl.setText(parts.join("  "));
	}

	async runResearch(editor: Editor, view: MarkdownView, useWebSearch: boolean) {
		const noteTitle = view.file?.basename ?? "";
		const existingContent = editor.getValue();
		const file = view.file;

		if (!file) return;

		this.activeResearchCount++;
		this.updateStatusBar();

		try {
			const activeProfile = this.profileManager.getActiveProfile();
			const result: ResearchResult = await research(
				noteTitle,
				existingContent,
				this.settings.apiKey,
				useWebSearch,
				activeProfile.frontmatterFields,
				activeProfile.userRules,
				activeProfile.systemPrompt,
				this.settings.modelName,
			);

			const cleaned = removeEmptyLines(result.content);

			// Insert frontmatter using processFrontMatter
			if (result.frontmatter && Object.keys(result.frontmatter).length > 0) {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					for (const [key, value] of Object.entries(result.frontmatter!)) {
						fm[key] = value;
					}
				});
			}

			// Append content using Vault.process so it works after frontmatter changes
			await this.app.vault.process(file, (data) => {
				const trimmed = data.trimEnd();
				return trimmed + "\n\n" + cleaned;
			});

			new Notice(`Research complete: ${noteTitle}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Research failed";
			new Notice(`${noteTitle}: ${msg}`);
		} finally {
			this.activeResearchCount--;
			this.updateStatusBar();
		}
	}

	async runGenerateImage(editor: Editor, view: MarkdownView) {
		const selection = editor.getSelection().trim();
		if (!selection) {
			new Notice("Select some text to use as an image prompt.");
			return;
		}

		const file = view.file;
		if (!file) return;

		this.activeImageCount++;
		this.updateStatusBar();

		try {
			const activeProfile = this.profileManager.getActiveProfile();
			const finalPrompt = activeProfile.imagePrompt.includes("{{selection}}")
				? activeProfile.imagePrompt.replace("{{selection}}", selection)
				: activeProfile.imagePrompt + "\n\n" + selection;
			const result = await generateImage(finalPrompt, this.settings.apiKey, this.settings.imageModelName);

			// Determine file extension from mime type
			const ext = result.mimeType.includes("jpeg") ? "jpg" : "png";
			const timestamp = Date.now();
			const fileName = `generated-${timestamp}.${ext}`;
			const parentPath = file.parent?.path;
			const imagePath = (parentPath && parentPath !== "/")
				? `${parentPath}/${fileName}`
				: fileName;

			// Decode base64 and save to vault
			const binary = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
			await this.app.vault.createBinary(imagePath, binary.buffer as ArrayBuffer);

			// Insert image embed after the selection, keeping original text
			const cursor = editor.getCursor("to");
			editor.replaceRange(`\n\n![[${fileName}]]`, cursor);

			new Notice("Image generated successfully.");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Image generation failed";
			new Notice(msg);
		} finally {
			this.activeImageCount--;
			this.updateStatusBar();
		}
	}

	async loadSettings() {
		const data = await this.loadData() ?? {};
		this.settings = migrateSettings(data);
		// If migration happened (legacy format), persist the migrated settings
		if (!Array.isArray(data.profiles)) {
			await this.saveSettings();
		}
		this.profileManager = new ProfileManager(this.settings, () => this.saveSettings());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
