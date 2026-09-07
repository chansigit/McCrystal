export const INTRO_MUSIC = 10146;
export const SELECT_MUSIC = 10147;
export const LOGIN_EFFECT = 10100;

export function registrationData(values) {
  if (values.Password !== values.Confirm) throw new Error("两次输入的密码不一致");
  if (values.AccountID.length < 3 || values.AccountID.length > 15) throw new Error("账号长度应为 3 至 15 个字符");
  if (values.Password.length < 5 || values.Password.length > 15) throw new Error("密码长度应为 5 至 15 个字符");
  if (!values.BirthDate) throw new Error("请输入出生日期");
  return { AccountID: values.AccountID, Password: values.Password,
    BirthDate: `${values.BirthDate}T00:00:00`, UserName: values.UserName,
    SecretQuestion: values.SecretQuestion, SecretAnswer: values.SecretAnswer,
    EMailAddress: values.EMailAddress };
}

export function playDoor(frame, finish, interval = 100) {
  let index = 0;
  frame(index);
  const timer = setInterval(() => {
    index++;
    frame(Math.min(index, 18));
    if (index >= 18) { clearInterval(timer); finish(); }
  }, interval);
  return timer;
}
