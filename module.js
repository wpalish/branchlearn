import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "branchlearn",
  reference: 88,
  title: "BranchLearn",
  description:
    "Пакеты обучения сотрудников с назначениями и проверяемыми ответами на контрольные вопросы. Это рабочий журнал, не защищённый экзамен.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C(
      "courses",
      "Пакеты обучения",
      [F("name", "Пакет"), F("material", "Учебный материал", "textarea")],
      { writeRole: "admin" },
    ),
    C(
      "checks",
      "Контрольные вопросы",
      [
        R("course", "Пакет", "courses"),
        F("question", "Вопрос"),
        F("answer", "Эталонный ответ"),
      ],
      { writeRole: "admin", labelField: "question" },
    ),
    C(
      "assignments",
      "Назначения",
      [
        R("course", "Пакет", "courses"),
        F("learner", "Обозначение сотрудника"),
        F("due", "Срок", "date"),
      ],
      { labelField: "learner" },
    ),
    C("responses", "Ответы", [
      R("assignment", "Назначение", "assignments"),
      R("check", "Вопрос", "checks"),
      F("answer", "Ответ сотрудника"),
    ]),
  ],
  validate(state, before, command, actor) {
    for (const response of live(state, "responses")) {
      const a = byId(state, "assignments", response.assignment),
        q = byId(state, "checks", response.check);
      required(a.course === q.course, "Вопрос относится к другому пакету.");
    }
    unique(
      live(state, "responses").map((x) => ({
        key: x.assignment + ":" + x.check,
      })),
      "key",
      "Ответ на вопрос в назначении",
    );
    for (const c of rows(state, "checks")) {
      const old = changed(before, "checks", c.id);
      if (old && rows(state, "responses").some((r) => r.check === c.id))
        immutable(old, c, ["course", "question", "answer", "archived"]);
    }
  },
  summarize(state) {
    return live(state, "assignments").map((a) => {
      const questions = live(state, "checks").filter(
          (q) => q.course === a.course,
        ),
        answers = live(state, "responses").filter((r) => r.assignment === a.id),
        passed = questions.filter((q) =>
          answers.some(
            (r) =>
              r.check === q.id &&
              r.answer.trim().toLocaleLowerCase() ===
                q.answer.trim().toLocaleLowerCase(),
          ),
        ).length;
      return summary(
        a.learner + " · " + byId(state, "courses", a.course).name,
        "Проверенных точных ответов: " + passed + " из " + questions.length,
        "Срок: " + a.due,
        "Эталон доступен команде; это самопроверка, не экзамен и не доказательство освоения навыка.",
      );
    });
  },
};
export default definition;
