import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { migrateSettings } from "../settings";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_IMAGE_PROMPT } from "../api_calls";

// Feature: profile-support, Property 1: Migration preserves legacy settings
// **Validates: Requirements 2.2, 9.1, 9.2, 9.3**

/**
 * Arbitrary for FrontmatterField[]
 */
const arbFrontmatterField = fc.record({
	name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
	type: fc.constantFrom("text" as const, "list" as const),
});

const arbFrontmatterFields = fc.array(arbFrontmatterField, { minLength: 0, maxLength: 5 });

/**
 * Arbitrary for legacy settings: top-level fields, no profiles key
 */
const arbLegacySettings = fc.record({
	apiKey: fc.string({ minLength: 0, maxLength: 50 }),
	systemPrompt: fc.string({ minLength: 0, maxLength: 200 }),
	imagePrompt: fc.string({ minLength: 0, maxLength: 200 }),
	userRules: fc.string({ minLength: 0, maxLength: 200 }),
	frontmatterFields: arbFrontmatterFields,
});

describe("Property 1: Migration preserves legacy settings", () => {
	it("should produce a single Default profile matching original values", () => {
		fc.assert(
			fc.property(arbLegacySettings, (legacy) => {
				const result = migrateSettings(legacy as unknown as Record<string, unknown>);

				// Exactly one profile named "Default"
				expect(result.profiles).toHaveLength(1);
				expect(result.profiles[0].name).toBe("Default");

				// activeProfileName is "Default"
				expect(result.activeProfileName).toBe("Default");

				// apiKey preserved at top level
				expect(result.apiKey).toBe(legacy.apiKey);

				// Profile fields match original legacy values
				const profile = result.profiles[0];
				expect(profile.systemPrompt).toBe(legacy.systemPrompt);
				expect(profile.imagePrompt).toBe(legacy.imagePrompt);
				expect(profile.userRules).toBe(legacy.userRules);
				expect(profile.frontmatterFields).toEqual(legacy.frontmatterFields);
			}),
			{ numRuns: 100 }
		);
	});
});

// Feature: profile-support, Property 2: Create adds a profile with default values
// **Validates: Requirements 3.2**

import { ProfileManager } from "../settings";
import { ResearchSettings, Profile } from "../types";

/**
 * Arbitrary for a Profile with a given name
 */
const arbProfileWithName = (name: string) =>
	fc.record({
		name: fc.constant(name),
		systemPrompt: fc.string({ minLength: 0, maxLength: 200 }),
		imagePrompt: fc.string({ minLength: 0, maxLength: 200 }),
		userRules: fc.string({ minLength: 0, maxLength: 200 }),
		frontmatterFields: arbFrontmatterFields,
	});

/**
 * Arbitrary for a non-empty, non-whitespace profile name
 */
const arbProfileName = fc
	.string({ minLength: 1, maxLength: 30 })
	.filter((s) => s.trim().length > 0);

/**
 * Arbitrary for ResearchSettings with 1-5 profiles (unique names) and a valid activeProfileName
 */
const arbResearchSettings: fc.Arbitrary<ResearchSettings> = fc
	.array(arbProfileName, { minLength: 1, maxLength: 5 })
	.chain((rawNames) => {
		// Deduplicate names
		const uniqueNames = [...new Set(rawNames.map((n) => n.trim()))];
		if (uniqueNames.length === 0) return fc.constant(null as unknown as { profiles: Profile[]; activeProfileName: string; apiKey: string });

		const profileArbs = uniqueNames.map((name) => arbProfileWithName(name));
		return fc.tuple(fc.tuple(...(profileArbs as [fc.Arbitrary<Profile>, ...fc.Arbitrary<Profile>[]])), fc.nat({ max: uniqueNames.length - 1 }), fc.string({ minLength: 0, maxLength: 50 })).map(
			([profiles, activeIdx, apiKey]) => ({
				apiKey,
				profiles,
				activeProfileName: profiles[activeIdx].name,
			})
		);
	})
	.filter((s): s is ResearchSettings => s !== null && s.profiles.length > 0);

describe("Property 2: Create adds a profile with default values", () => {
	it("should add a profile with default values for any valid new name", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings,
				arbProfileName,
				async (settings, newName) => {
					const trimmedName = newName.trim();
					// Skip if name already exists in profiles
					if (settings.profiles.some((p) => p.name === trimmedName)) return;

					const originalLength = settings.profiles.length;
					const manager = new ProfileManager(
						{ ...settings, profiles: settings.profiles.map((p) => ({ ...p, frontmatterFields: [...p.frontmatterFields] })) },
						async () => {}
					);

					// Act
					const created = await manager.create(trimmedName);

					// Assert — length increased by one
					expect(manager["settings"].profiles).toHaveLength(originalLength + 1);

					// New profile has the given name
					expect(created.name).toBe(trimmedName);

					// New profile has default values
					expect(created.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
					expect(created.imagePrompt).toBe(DEFAULT_IMAGE_PROMPT);
					expect(created.userRules).toBe("");
					expect(created.frontmatterFields).toEqual([]);
				}
			),
			{ numRuns: 100 }
		);
	});
});

// Feature: profile-support, Property 3: Name validation rejects empty and whitespace-only names
// **Validates: Requirements 3.4, 7.4**

/**
 * Arbitrary for whitespace-only strings (spaces, tabs, newlines, empty string)
 */
const arbWhitespaceOnly = fc
	.array(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 0, maxLength: 20 })
	.map((chars) => chars.join(""));

describe("Property 3: Name validation rejects empty and whitespace-only names", () => {
	it("should reject create() and renameActive() for whitespace-only names, leaving profiles unchanged", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings,
				arbWhitespaceOnly,
				async (settings, wsName) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const originalProfiles = settingsCopy.profiles.map((p) => ({
						...p,
						frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
					}));

					const manager = new ProfileManager(settingsCopy, async () => {});

					// create() should throw
					await expect(manager.create(wsName)).rejects.toThrow(
						"Profile name cannot be empty."
					);

					// Profiles array unchanged after failed create
					expect(settingsCopy.profiles).toEqual(originalProfiles);

					// renameActive() should throw
					await expect(manager.renameActive(wsName)).rejects.toThrow(
						"Profile name cannot be empty."
					);

					// Profiles array unchanged after failed rename
					expect(settingsCopy.profiles).toEqual(originalProfiles);
				}
			),
			{ numRuns: 100 }
		);
	});
});

// Feature: profile-support, Property 4: Name validation rejects duplicate names
// **Validates: Requirements 3.3, 7.3**

/**
 * Arbitrary for ResearchSettings with at least 2 profiles (unique names) and a valid activeProfileName.
 * Needed so we can rename the active profile to match another existing profile's name.
 */
const arbResearchSettingsAtLeast2: fc.Arbitrary<ResearchSettings> = fc
	.array(arbProfileName, { minLength: 2, maxLength: 5 })
	.chain((rawNames) => {
		const uniqueNames = [...new Set(rawNames.map((n) => n.trim()))];
		if (uniqueNames.length < 2) return fc.constant(null as unknown as ResearchSettings);

		const profileArbs = uniqueNames.map((name) => arbProfileWithName(name));
		return fc
			.tuple(
				fc.tuple(...(profileArbs as [fc.Arbitrary<Profile>, ...fc.Arbitrary<Profile>[]])),
				fc.nat({ max: uniqueNames.length - 1 }),
				fc.string({ minLength: 0, maxLength: 50 })
			)
			.map(([profiles, activeIdx, apiKey]) => ({
				apiKey,
				profiles,
				activeProfileName: profiles[activeIdx].name,
			}));
	})
	.filter((s): s is ResearchSettings => s !== null && s.profiles.length >= 2);

describe("Property 4: Name validation rejects duplicate names", () => {
	it("should reject create() and renameActive() for duplicate names, leaving profiles unchanged", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettingsAtLeast2,
				async (settings) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const originalProfiles = settingsCopy.profiles.map((p) => ({
						...p,
						frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
					}));

					const manager = new ProfileManager(settingsCopy, async () => {});

					// Pick an existing profile name to use as the duplicate
					const existingName = settingsCopy.profiles[0].name;

					// create() with an existing name should throw
					await expect(manager.create(existingName)).rejects.toThrow(
						`A profile named '${existingName}' already exists.`
					);

					// Profiles array unchanged after failed create
					expect(settingsCopy.profiles).toEqual(originalProfiles);

					// For renameActive: pick a different profile's name to rename to
					const activeProfile = manager.getActiveProfile();
					const otherProfile = settingsCopy.profiles.find(
						(p) => p.name !== activeProfile.name
					);
					// We have at least 2 profiles, so otherProfile must exist
					expect(otherProfile).toBeDefined();

					// renameActive() to an existing (other) profile's name should throw
					await expect(
						manager.renameActive(otherProfile!.name)
					).rejects.toThrow(
						`A profile named '${otherProfile!.name}' already exists.`
					);

					// Profiles array unchanged after failed rename
					expect(settingsCopy.profiles).toEqual(originalProfiles);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 5: Switch and retrieve active profile
// **Validates: Requirements 4.2, 4.4**

describe("Property 5: Switch and retrieve active profile", () => {
	it("should return the switched-to profile from getActiveProfile()", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings.chain((settings) => {
					// Pick a random index into the profiles array to switch to
					return fc.tuple(
						fc.constant(settings),
						fc.nat({ max: settings.profiles.length - 1 })
					);
				}),
				async ([settings, targetIdx]) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const targetName = settingsCopy.profiles[targetIdx].name;
					const manager = new ProfileManager(settingsCopy, async () => {});

					// Act
					await manager.switchTo(targetName);
					const active = manager.getActiveProfile();

					// Assert — the active profile's name matches the switched-to name
					expect(active.name).toBe(targetName);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 6: Field mutations persist to active profile
// **Validates: Requirements 5.1**

describe("Property 6: Field mutations persist to active profile", () => {
	it("should return updated values from getActiveProfile() after mutating fields and saving", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings,
				fc.string({ minLength: 0, maxLength: 200 }),
				fc.string({ minLength: 0, maxLength: 200 }),
				fc.string({ minLength: 0, maxLength: 200 }),
				arbFrontmatterFields,
				async (settings, newSystemPrompt, newImagePrompt, newUserRules, newFrontmatterFields) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const manager = new ProfileManager(settingsCopy, async () => {});

					// Get the active profile and mutate all fields
					const active = manager.getActiveProfile();
					active.systemPrompt = newSystemPrompt;
					active.imagePrompt = newImagePrompt;
					active.userRules = newUserRules;
					active.frontmatterFields = newFrontmatterFields;

					// Persist the changes
					await manager.saveActiveProfile();

					// Retrieve the active profile again and verify updated values
					const retrieved = manager.getActiveProfile();
					expect(retrieved.systemPrompt).toBe(newSystemPrompt);
					expect(retrieved.imagePrompt).toBe(newImagePrompt);
					expect(retrieved.userRules).toBe(newUserRules);
					expect(retrieved.frontmatterFields).toEqual(newFrontmatterFields);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 7: Delete removes profile and switches to first remaining
// **Validates: Requirements 6.2**

describe("Property 7: Delete removes profile and switches to first remaining", () => {
	it("should reduce profiles by one, remove the deleted name, and switch to first remaining", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettingsAtLeast2,
				async (settings) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const originalLength = settingsCopy.profiles.length;
					const activeName = settingsCopy.activeProfileName;

					const manager = new ProfileManager(settingsCopy, async () => {});

					// Act
					await manager.deleteActive();

					// Assert — length decreased by one
					expect(settingsCopy.profiles).toHaveLength(originalLength - 1);

					// Deleted profile name no longer in array
					expect(settingsCopy.profiles.some((p) => p.name === activeName)).toBe(false);

					// activeProfileName equals the first remaining profile's name
					expect(settingsCopy.activeProfileName).toBe(settingsCopy.profiles[0].name);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 8: Cannot delete last profile
// **Validates: Requirements 2.3, 6.3**

/**
 * Arbitrary for ResearchSettings with exactly 1 profile
 */
const arbResearchSettingsExactly1: fc.Arbitrary<ResearchSettings> = arbProfileName
	.chain((name) =>
		fc.tuple(
			arbProfileWithName(name),
			fc.string({ minLength: 0, maxLength: 50 })
		).map(([profile, apiKey]) => ({
			apiKey,
			profiles: [profile],
			activeProfileName: profile.name,
		}))
	);

describe("Property 8: Cannot delete last profile", () => {
	it("should throw an error and leave profiles unchanged when deleting the only profile", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettingsExactly1,
				async (settings) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const originalProfile = {
						...settingsCopy.profiles[0],
						frontmatterFields: settingsCopy.profiles[0].frontmatterFields.map((f) => ({ ...f })),
					};

					const manager = new ProfileManager(settingsCopy, async () => {});

					// deleteActive() should throw
					await expect(manager.deleteActive()).rejects.toThrow(
						"Cannot delete the only remaining profile."
					);

					// Profiles array still has exactly one profile
					expect(settingsCopy.profiles).toHaveLength(1);

					// The profile is unchanged
					expect(settingsCopy.profiles[0]).toEqual(originalProfile);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 9: Rename updates name and active reference
// **Validates: Requirements 7.2**

describe("Property 9: Rename updates name and active reference", () => {
	it("should update the profile name and activeProfileName to newName with profile count unchanged", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings,
				arbProfileName,
				async (settings, newName) => {
					const trimmedNew = newName.trim();
					// Skip if name already exists in profiles (must be a valid, non-duplicate name)
					if (settings.profiles.some((p) => p.name === trimmedNew)) return;

					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const originalLength = settingsCopy.profiles.length;
					const manager = new ProfileManager(settingsCopy, async () => {});

					// Act
					await manager.renameActive(trimmedNew);

					// Assert — profile count unchanged
					expect(settingsCopy.profiles).toHaveLength(originalLength);

					// activeProfileName equals newName
					expect(settingsCopy.activeProfileName).toBe(trimmedNew);

					// getActiveProfile().name equals newName
					expect(manager.getActiveProfile().name).toBe(trimmedNew);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 10: Duplicate copies values and activates the copy
// **Validates: Requirements 8.2, 8.4**

describe("Property 10: Duplicate copies values and activates the copy", () => {
	it("should increase profiles by one, copy all field values, and activate the new profile", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbResearchSettings,
				async (settings) => {
					// Deep-copy settings so mutations don't leak between runs
					const settingsCopy: ResearchSettings = {
						apiKey: settings.apiKey,
						profiles: settings.profiles.map((p) => ({
							...p,
							frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })),
						})),
						activeProfileName: settings.activeProfileName,
					};

					const manager = new ProfileManager(settingsCopy, async () => {});

					const originalLength = settingsCopy.profiles.length;
					const originalActive = manager.getActiveProfile();
					const originalValues = {
						systemPrompt: originalActive.systemPrompt,
						imagePrompt: originalActive.imagePrompt,
						userRules: originalActive.userRules,
						frontmatterFields: originalActive.frontmatterFields.map((f) => ({ ...f })),
					};
					const originalName = originalActive.name;

					// Act
					const duplicate = await manager.duplicateActive();

					// Assert — length increased by one
					expect(settingsCopy.profiles).toHaveLength(originalLength + 1);

					// New profile has identical field values
					expect(duplicate.systemPrompt).toBe(originalValues.systemPrompt);
					expect(duplicate.imagePrompt).toBe(originalValues.imagePrompt);
					expect(duplicate.userRules).toBe(originalValues.userRules);
					expect(duplicate.frontmatterFields).toEqual(originalValues.frontmatterFields);

					// activeProfileName equals the new profile's name
					expect(settingsCopy.activeProfileName).toBe(duplicate.name);

					// New profile's name is different from original
					expect(duplicate.name).not.toBe(originalName);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 11: Duplicate naming produces unique names
// **Validates: Requirements 8.3**

describe("Property 11: Duplicate naming produces unique names", () => {
	it("should produce a unique name following the (Copy N) pattern when (Copy) already exists", async () => {
		await fc.assert(
			fc.asyncProperty(
				arbProfileName,
				fc.integer({ min: 1, max: 10 }),
				async (baseName, existingCopies) => {
					// Build profiles: the base profile + some existing "(Copy)" variants
					const profiles: Profile[] = [
						{
							name: baseName,
							systemPrompt: "sp",
							imagePrompt: "ip",
							userRules: "",
							frontmatterFields: [],
						},
						{
							name: `${baseName} (Copy)`,
							systemPrompt: "sp",
							imagePrompt: "ip",
							userRules: "",
							frontmatterFields: [],
						},
					];

					// Add "(Copy 2)" through "(Copy existingCopies)" if existingCopies >= 2
					for (let n = 2; n <= existingCopies; n++) {
						profiles.push({
							name: `${baseName} (Copy ${n})`,
							systemPrompt: "sp",
							imagePrompt: "ip",
							userRules: "",
							frontmatterFields: [],
						});
					}

					const settings: ResearchSettings = {
						apiKey: "",
						profiles: profiles.map(p => ({ ...p })),
						activeProfileName: baseName,
					};

					const manager = new ProfileManager(settings, async () => {});

					// Act
					const duplicate = await manager.duplicateActive();

					// The expected name is "(Copy N)" where N is the smallest integer >= 2 not already taken
					const expectedN = existingCopies + 1;
					const expectedName = expectedN === 1
						? `${baseName} (Copy)`
						: `${baseName} (Copy ${expectedN})`;

					// Assert — name matches expected pattern
					expect(duplicate.name).toBe(expectedName);

					// Assert — name is unique across all profiles
					const names = settings.profiles.map(p => p.name);
					expect(new Set(names).size).toBe(names.length);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: profile-support, Property 12: Skip migration when profiles already exist
// **Validates: Requirements 9.4**

describe("Property 12: Skip migration when profiles already exist", () => {
	it("should preserve profiles and activeProfileName as-is without creating a Default profile", () => {
		fc.assert(
			fc.property(arbResearchSettings, (settings) => {
				// Convert to raw persisted data (Record<string, unknown>)
				const rawData: Record<string, unknown> = {
					apiKey: settings.apiKey,
					profiles: settings.profiles.map((p) => ({ ...p, frontmatterFields: p.frontmatterFields.map((f) => ({ ...f })) })),
					activeProfileName: settings.activeProfileName,
				};

				const result = migrateSettings(rawData);

				// Profiles array is preserved as-is
				expect(result.profiles).toEqual(rawData.profiles);

				// activeProfileName is preserved
				expect(result.activeProfileName).toBe(settings.activeProfileName);

				// apiKey is preserved
				expect(result.apiKey).toBe(settings.apiKey);

				// No extra "Default" profile was injected
				const defaultCount = result.profiles.filter((p) => p.name === "Default").length;
				const originalDefaultCount = settings.profiles.filter((p) => p.name === "Default").length;
				expect(defaultCount).toBe(originalDefaultCount);

				// Profile count unchanged
				expect(result.profiles).toHaveLength(settings.profiles.length);
			}),
			{ numRuns: 100 }
		);
	});
});


// ── Unit Tests: Migration and Command Wiring ────────────────────────────
// **Validates: Requirements 2.1, 9.1, 9.2, 9.3, 9.4**

describe("Unit: Migration and first-load behavior", () => {
	it("first-load with empty data produces one Default profile with known defaults", () => {
		const result = migrateSettings({});

		expect(result.profiles).toHaveLength(1);
		expect(result.profiles[0].name).toBe("Default");
		expect(result.profiles[0].systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(result.profiles[0].imagePrompt).toBe(DEFAULT_IMAGE_PROMPT);
		expect(result.profiles[0].userRules).toBe("");
		expect(result.profiles[0].frontmatterFields).toEqual([]);
		expect(result.activeProfileName).toBe("Default");
		expect(result.apiKey).toBe("");
	});

	it("legacy data with custom values migrates into Default profile preserving all values and apiKey", () => {
		const legacy = {
			apiKey: "my-secret-key",
			systemPrompt: "Custom system prompt",
			imagePrompt: "Custom image prompt",
			userRules: "Always write in Spanish.",
			frontmatterFields: [
				{ name: "tags", type: "list" },
				{ name: "summary", type: "text" },
			],
		};

		const result = migrateSettings(legacy as Record<string, unknown>);

		expect(result.profiles).toHaveLength(1);
		expect(result.profiles[0].name).toBe("Default");
		expect(result.profiles[0].systemPrompt).toBe("Custom system prompt");
		expect(result.profiles[0].imagePrompt).toBe("Custom image prompt");
		expect(result.profiles[0].userRules).toBe("Always write in Spanish.");
		expect(result.profiles[0].frontmatterFields).toEqual([
			{ name: "tags", type: "list" },
			{ name: "summary", type: "text" },
		]);
		expect(result.activeProfileName).toBe("Default");
		expect(result.apiKey).toBe("my-secret-key");
	});

	it("already-migrated data with profiles array is not re-migrated", () => {
		const existing = {
			apiKey: "existing-key",
			activeProfileName: "Work",
			profiles: [
				{
					name: "Work",
					systemPrompt: "Work prompt",
					imagePrompt: "Work image",
					userRules: "Be formal.",
					frontmatterFields: [{ name: "project", type: "text" }],
				},
				{
					name: "Personal",
					systemPrompt: "Personal prompt",
					imagePrompt: "Personal image",
					userRules: "",
					frontmatterFields: [],
				},
			],
		};

		const result = migrateSettings(existing as Record<string, unknown>);

		expect(result.profiles).toHaveLength(2);
		expect(result.profiles[0].name).toBe("Work");
		expect(result.profiles[1].name).toBe("Personal");
		expect(result.activeProfileName).toBe("Work");
		expect(result.apiKey).toBe("existing-key");
		// Verify profile values are preserved exactly
		expect(result.profiles[0].systemPrompt).toBe("Work prompt");
		expect(result.profiles[1].frontmatterFields).toEqual([]);
	});
});


// ── Unit Tests: Reset prompt behavior, duplicate naming, and fallback ───
// **Validates: Requirements 5.2, 5.3, 8.3**

describe("Unit: Reset prompt and edge-case behavior", () => {
	it("reset research prompt sets active profile's systemPrompt to DEFAULT_SYSTEM_PROMPT (Req 5.2)", async () => {
		const settings: ResearchSettings = {
			apiKey: "key",
			profiles: [
				{
					name: "Custom",
					systemPrompt: "My custom research prompt",
					imagePrompt: "My custom image prompt",
					userRules: "some rules",
					frontmatterFields: [],
				},
			],
			activeProfileName: "Custom",
		};

		const manager = new ProfileManager(settings, async () => {});

		// Simulate the reset button behavior
		manager.getActiveProfile().systemPrompt = DEFAULT_SYSTEM_PROMPT;
		await manager.saveActiveProfile();

		expect(manager.getActiveProfile().systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
	});

	it("reset image prompt sets active profile's imagePrompt to DEFAULT_IMAGE_PROMPT (Req 5.3)", async () => {
		const settings: ResearchSettings = {
			apiKey: "key",
			profiles: [
				{
					name: "Custom",
					systemPrompt: "My custom research prompt",
					imagePrompt: "My custom image prompt",
					userRules: "some rules",
					frontmatterFields: [],
				},
			],
			activeProfileName: "Custom",
		};

		const manager = new ProfileManager(settings, async () => {});

		// Simulate the reset button behavior
		manager.getActiveProfile().imagePrompt = DEFAULT_IMAGE_PROMPT;
		await manager.saveActiveProfile();

		expect(manager.getActiveProfile().imagePrompt).toBe(DEFAULT_IMAGE_PROMPT);
	});

	it("duplicate of 'Foo' when 'Foo (Copy)' and 'Foo (Copy 2)' exist produces 'Foo (Copy 3)' (Req 8.3)", async () => {
		const settings: ResearchSettings = {
			apiKey: "",
			profiles: [
				{
					name: "Foo",
					systemPrompt: "sp",
					imagePrompt: "ip",
					userRules: "",
					frontmatterFields: [],
				},
				{
					name: "Foo (Copy)",
					systemPrompt: "sp",
					imagePrompt: "ip",
					userRules: "",
					frontmatterFields: [],
				},
				{
					name: "Foo (Copy 2)",
					systemPrompt: "sp",
					imagePrompt: "ip",
					userRules: "",
					frontmatterFields: [],
				},
			],
			activeProfileName: "Foo",
		};

		const manager = new ProfileManager(settings, async () => {});
		const duplicate = await manager.duplicateActive();

		expect(duplicate.name).toBe("Foo (Copy 3)");
	});

	it("getActiveProfile falls back to first profile when activeProfileName is stale", () => {
		const settings: ResearchSettings = {
			apiKey: "",
			profiles: [
				{
					name: "Alpha",
					systemPrompt: "sp",
					imagePrompt: "ip",
					userRules: "",
					frontmatterFields: [],
				},
				{
					name: "Beta",
					systemPrompt: "sp2",
					imagePrompt: "ip2",
					userRules: "",
					frontmatterFields: [],
				},
			],
			activeProfileName: "NonExistentProfile",
		};

		const manager = new ProfileManager(settings, async () => {});
		const active = manager.getActiveProfile();

		expect(active.name).toBe("Alpha");
	});
});
