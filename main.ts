import {Editor, MarkdownView, Notice, Plugin} from "obsidian";
import {ResearchSettings} from "./src/types";
import {DEFAULT_SETTINGS, ResearchSettingTab, ProfileManager, migrateSettings} from "./src/settings";
import {research, ResearchResult, generateImage} from "./src/api_calls";
import {removeEmptyLines} from "./src/helpers";

export default class ResearchPlugin extends Plugin {
	settings: ResearchSettings;
	profileManager: ProfileManager;
	statusBarEl: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ResearchSettingTab(this.app, this));
		this.statusBarEl = this.addStatusBarItem();

		this.addCommand({
			id: "research",
			name: "Research",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runResearch(editor, view, false);
			},
		});

		this.addCommand({
			id: "research-web",
			name: "Research with web search",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runResearch(editor, view, true);
			},
		});

		this.addCommand({
			id: "generate-image",
			name: "Generate image from selected text",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runGenerateImage(editor, view);
			},
		});
	}

	async runResearch(editor: Editor, view: MarkdownView, useWebSearch: boolean) {
		const noteTitle = view.file?.basename ?? "";
		const existingContent = editor.getValue();
		const file = view.file;

		if (!file) return;

		this.statusBarEl.setText(useWebSearch ? "🔍 Researching with web..." : "🔍 Researching...");

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
				// Strip trailing whitespace/newlines, then just add two newlines before content
				const trimmed = data.trimEnd();
				return trimmed + "\n\n" + cleaned;
			});

			this.statusBarEl.setText("");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Research failed";
			this.statusBarEl.setText(msg);
			setTimeout(() => this.statusBarEl.setText(""), 10000);
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

		this.statusBarEl.setText("🎨 Generating image...");

		try {
			const activeProfile = this.profileManager.getActiveProfile();
			const finalPrompt = activeProfile.imagePrompt.includes("{{selection}}")
				? activeProfile.imagePrompt.replace("{{selection}}", selection)
				: activeProfile.imagePrompt + "\n\n" + selection;
			const result = await generateImage(finalPrompt, this.settings.apiKey);

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

			this.statusBarEl.setText("");
			new Notice("Image generated successfully.");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Image generation failed";
			this.statusBarEl.setText(msg);
			new Notice(msg);
			setTimeout(() => this.statusBarEl.setText(""), 10000);
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
