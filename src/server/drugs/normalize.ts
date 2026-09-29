export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
export const normalizeIngredient = (s: string) => collapse(s).toLowerCase();
export const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
