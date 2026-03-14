/**
 * Removes excessive empty lines, keeping at most one blank line between content.
 */
export function removeEmptyLines(text: string): string {
	return text.replace(/(\n{3,})/g, "\n\n");
}
