// The character screen of the native client (Client/MirScenes/SelectScene.cs) is
// the authority here: it owns the result-code wording and the delete gate that
// makes the player retype the name before C.DeleteCharacter is ever queued.
export const CLASS_NAMES = ["战士", "法师", "道士", "刺客", "弓手"];
export const GENDER_NAMES = ["男", "女"];
// Globals.MinCharacterNameLength / MaxCharacterNameLength / MaxCharacterCount.
const MIN_NAME = 3;
const MAX_NAME = 15;
const MAX_CHARACTERS = 4;
// The server's CharacterReg (Server/MirEnvir/Envir.cs) — Chinese, latin, digits
// and underscore only. Rejecting locally saves a round trip; the server still
// decides, because it also owns the disabled-name list.
const NAME_PATTERN = new RegExp(`^[\\u4e00-\\u9fa5_A-Za-z0-9]{${MIN_NAME},${MAX_NAME}}$`);

// S.NewCharacter.Result, worded from Client/Localization/Chinese.json through the
// switch in SelectScene.NewCharacter. Code 3 also covers a class the server
// disabled via AllowCreateAssassin / AllowCreateArcher, so it says both.
export const CREATE_ERRORS = {
  0: "当前禁止创建新角色。",
  1: "您的角色名称不符合要求。",
  2: "您选择的性别不存在。请联系GM寻求帮助。",
  3: "您选择的职业不存在或尚未开放。请联系GM寻求帮助。",
  4: `您不能创建超过 ${MAX_CHARACTERS} 个角色。`,
  5: "已存在同名角色。",
};
// S.DeleteCharacter.Result, from SelectScene.DeleteCharacter.
export const DELETE_ERRORS = {
  0: "当前禁止删除角色。",
  1: "您选择的角色不存在。请联系GM寻求帮助。",
};

export function characterNameError(name) {
  if (!name) return "请输入角色名。";
  if (!NAME_PATTERN.test(name))
    return `角色名需为 ${MIN_NAME}-${MAX_NAME} 个汉字、字母、数字或下划线。`;
  return null;
}

function fillOptions(select, labels) {
  select.replaceChildren(
    ...labels.map((label, value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      return option;
    }),
  );
}

export class CharacterScreen {
  constructor(send) {
    this.send = send;
    this.target = null;
    this.status = document.getElementById("character-status");
    this.openButton = document.getElementById("open-create");
    this.createForm = document.getElementById("create-form");
    this.createName = document.getElementById("create-name");
    this.createGender = document.getElementById("create-gender");
    this.createClass = document.getElementById("create-class");
    this.createButton = document.getElementById("create-submit");
    this.createStatus = document.getElementById("create-status");
    this.cancelCreate = document.getElementById("cancel-create");
    this.deleteForm = document.getElementById("delete-form");
    this.deletePrompt = document.getElementById("delete-prompt");
    this.deleteName = document.getElementById("delete-name");
    this.deleteButton = document.getElementById("delete-confirm");
    this.deleteStatus = document.getElementById("delete-status");
    this.cancelDelete = document.getElementById("cancel-delete");
    fillOptions(this.createGender, GENDER_NAMES);
    fillOptions(this.createClass, CLASS_NAMES);
    this.openButton.onclick = () => this.openCreate();
    this.cancelCreate.onclick = () => this.closeCreate();
    this.createForm.onsubmit = (event) => { event?.preventDefault(); this.submitCreate(); };
    this.cancelDelete.onclick = () => this.closeDelete();
    this.deleteForm.onsubmit = (event) => { event?.preventDefault(); this.submitDelete(); };
  }
  // Called every time the list is re-rendered, so a stale form can never be left
  // pointing at a character that no longer exists.
  reset(count = 0) {
    this.closeCreate();
    this.closeDelete();
    this.status.textContent = "";
    this.openButton.disabled = count >= MAX_CHARACTERS;
    this.openButton.title = this.openButton.disabled ? `最多只能拥有 ${MAX_CHARACTERS} 个角色` : "";
  }
  message(text) {
    this.status.textContent = text;
  }
  openCreate() {
    this.closeDelete();
    this.status.textContent = "";
    this.createForm.hidden = false;
    this.createButton.disabled = false;
    this.createName.value = "";
    this.createStatus.textContent = "";
    this.createName.focus?.();
  }
  closeCreate() {
    this.createForm.hidden = true;
    this.createStatus.textContent = "";
    this.createButton.disabled = false;
  }
  submitCreate() {
    const name = (this.createName.value || "").trim();
    const error = characterNameError(name);
    if (error) { this.createStatus.textContent = error; return false; }
    const data = {
      Name: name,
      Gender: Number(this.createGender.value),
      Class: Number(this.createClass.value),
    };
    if (!this.send("NewCharacter", data)) { this.createStatus.textContent = "连接已断开"; return false; }
    this.createButton.disabled = true;
    this.createStatus.textContent = "正在创建角色…";
    return true;
  }
  createFailed(result) {
    this.createButton.disabled = false;
    this.createStatus.textContent = CREATE_ERRORS[result] || `创建角色失败 (${result})`;
  }
  openDelete(character) {
    this.closeCreate();
    this.status.textContent = "";
    this.target = character;
    this.deleteForm.hidden = false;
    this.deleteButton.disabled = false;
    this.deletePrompt.textContent = `删除“${character.Name}”后无法恢复。`;
    this.deleteName.value = "";
    this.deleteStatus.textContent = "";
    this.deleteName.focus?.();
  }
  closeDelete() {
    this.deleteForm.hidden = true;
    this.deleteStatus.textContent = "";
    this.deleteButton.disabled = false;
    this.target = null;
  }
  // Deletion is irreversible, so the exact name is the only thing that unlocks it.
  submitDelete() {
    if (!this.target) return false;
    if ((this.deleteName.value || "").trim() !== this.target.Name) {
      this.deleteStatus.textContent = "输入有误。";
      return false;
    }
    if (!this.send("DeleteCharacter", { CharacterIndex: this.target.Index })) {
      this.deleteStatus.textContent = "连接已断开";
      return false;
    }
    this.deleteButton.disabled = true;
    this.deleteStatus.textContent = "正在删除角色…";
    return true;
  }
  deleteFailed(result) {
    this.deleteButton.disabled = false;
    this.deleteStatus.textContent = DELETE_ERRORS[result] || `删除角色失败 (${result})`;
  }
}
