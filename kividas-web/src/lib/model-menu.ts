import type { Model } from "./types";
export const effortOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra" },
  { value: "max", label: "Max" },
] as const;
export type Effort = (typeof effortOptions)[number]["value"];
export function validEffort(value: unknown): Effort {
  return effortOptions.some((e) => e.value === value)
    ? (value as Effort)
    : "medium";
}
export function modelLabel(model: Model) {
  return model.name.replace(/^Claude\s+/i, "");
}
function family(model: Model) {
  return /\b(fable|opus|sonnet|haiku)\b/i
    .exec(`${model.name} ${model.id}`)?.[1]
    ?.toLowerCase();
}
export function primaryModels(models: Model[]) {
  const primary = ["fable", "opus", "sonnet", "haiku"].flatMap((name) => {
    const model = models.find((m) => family(m) === name);
    return model ? [model] : [];
  });
  return primary.length ? primary : models.slice(0, 4);
}
export function modelDescription(model: Model) {
  const descriptions: Record<string, string> = {
    fable: "For your toughest challenges",
    opus: "Most capable for ambitious work",
    sonnet: "Most efficient for everyday tasks",
    haiku: "Fastest for quick answers",
  };
  return (
    descriptions[family(model) || ""] ||
    model.info?.meta?.description ||
    model.id
  );
}
export function supportsEffort(model: Model | undefined) {
  if (!model || model.info?.meta?.capabilities?.reasoning === false)
    return false;
  if (model.info?.meta?.capabilities?.reasoning === true) return true;
  return (
    /\b(opus|sonnet|fable)\b/i.test(`${model.id} ${model.name}`) ||
    /(?:^|\/)(?:gpt-[5-9]|o[1-9])/.test(model.id.toLowerCase())
  );
}
export function reasoningParams(model: Model | undefined, effort: Effort) {
  return supportsEffort(model) ? { reasoning_effort: effort } : {};
}
