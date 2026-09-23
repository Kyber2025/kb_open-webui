import { describe, it, expect } from "vitest";
import { selectedSkillIds, skillForm, type Skill } from "../src/lib/skills";
const skill: Skill = {
  id: "mine",
  user_id: "u",
  name: "Draft",
  content: "Preserve facts.",
  description: "Writing",
  meta: { tags: ["writing"] },
  is_active: true,
  access_grants: [{ principal_id: "team", permission: "read" }],
};
describe("skill selection and editing", () => {
  it("rejects inaccessible or disabled selections and removes duplicates", () => {
    expect(
      selectedSkillIds(
        ["mine", "disabled", "unknown", "mine"],
        [skill, { ...skill, id: "disabled", is_active: false }],
      ),
    ).toEqual(["mine"]);
  });
  it("preserves instruction content, sharing and tags when editing", () => {
    expect(skillForm(skill)).toMatchObject({
      content: skill.content,
      access_grants: skill.access_grants,
      meta: skill.meta,
      is_active: true,
    });
  });
  it("does not grant access when a skill has no grants", () => {
    expect(
      skillForm({ ...skill, access_grants: undefined }).access_grants,
    ).toEqual([]);
  });
});
