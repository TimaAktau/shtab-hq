/* HQ Brain — deterministic orchestrator. No network. */
(function (root) {
  const RULES = [
    { agent: "brand", re: /og|баннер|favicon|палитр|site\.json|бренд|картинк|ассет/i },
    { agent: "writer", re: /текст|стор|копирайт|описан|кириллиц/i },
    { agent: "researcher", re: /правил|yandex games докум|референс|поиск|конкурент/i },
    { agent: "docs", re: /скилл|протокол|handoff|баз[аы]|штаб|сайт/i },
    { agent: "game-dev", re: /кликер|баланс|ui|код|механик|билд|репозитор|игра/i }
  ];
  const CONSTITUTION = [
    "Не выдумывать прогресс игр, которого нет в карточках.",
    "Источник правды — состояние штаба, не обрывки чата.",
    "Один активный проект. Одна задача в работе.",
    "Перед концом сессии всегда пересобрать HANDOFF.",
    "Выключенного агента не назначать исполнителем.",
    "Секреты, ключи и пароли в мозг не писать."
  ];
  function project(state, id) { return (state.projects || []).find(p => p.id === id) || null; }
  function agent(state, id) { return (state.agents || []).find(a => a.id === id) || null; }
  function pname(state, id) { return project(state, id)?.name || id || "—"; }
  function aname(state, id) { return agent(state, id)?.name || id || "—"; }
  function route(title, state) {
    const text = String(title || "");
    for (const rule of RULES) { if (rule.re.test(text) && agent(state, rule.agent)) return rule.agent; }
    return "orchestrator";
  }
  function pickTask(state) {
    const tasks = state.tasks || [];
    return tasks.find(t => t.lane === "now") || tasks.find(t => t.lane === "next") || null;
  }
  function blockers(state) {
    const list = [];
    const b = (state.handoff && state.handoff.blockers || "").trim();
    if (b && !/^none$|^нет$/i.test(b)) list.push(b);
    const games = (state.projects || []).filter(p => /astral|ether|ядро|эфир/i.test(p.id + p.name));
    games.forEach(p => { if (/не указан|уточнить|пусто/i.test(p.note || "")) list.push(`${p.name}: нет пути репозитория / фактов`); });
    const on = (state.agents || []).filter(a => a.status === "on" || a.status === "work");
    if (!on.length) list.push("Нет включённых агентов");
    return list;
  }
  function think(state) {
    const task = pickTask(state);
    const block = blockers(state);
    const active = project(state, state.state?.activeProject);
    let chosen = task ? route(task.title + " " + (task.project || ""), state) : "orchestrator";
    if (task && task.agent) chosen = task.agent;
    const ag = agent(state, chosen);
    const agentOk = ag && ag.status !== "off";
    let verdict = "ready";
    let thought = "";
    if (!task) { verdict = "idle"; thought = "Очередь пуста. Мозг ждёт новую задачу или выбор главного проекта."; }
    else if (!agentOk) { verdict = "blocked"; thought = `Задача «${task.title}» хочет роль ${aname(state, chosen)}, но агент выключен.`; }
    else if (block.length && /репозитор/i.test(block.join(" ")) && /репозитор|стек|путь|факт/i.test(task.title)) {
      verdict = "ready"; thought = `Главный пробел — факты по игре. Берём «${task.title}» через ${aname(state, chosen)}.`;
    } else {
      thought = `Следующий ход: «${task.title}». Проект ${pname(state, task.project)}. Исполнитель ${aname(state, chosen)}.`;
    }
    const packet = compileHandoff(state, { task, chosen, thought, block, verdict });
    return { verdict, thought, constitution: CONSTITUTION, activeProject: active ? active.name : "не выбран", task, agentId: chosen, agentName: aname(state, chosen), blockers: block, packet, grokPrompt: grokPrompt(state, { task, chosen, thought, verdict }) };
  }
  function compileHandoff(state, ctx) {
    const now = (state.tasks || []).filter(t => t.lane === "now").map(t => t.title);
    const next = (state.tasks || []).filter(t => t.lane === "next").map(t => t.title);
    const done = (state.tasks || []).filter(t => t.lane === "done").slice(0, 6).map(t => t.title);
    return { from: "brain", to: ctx.chosen || "next agent", done: done.join("; ") || state.handoff?.done || "", progress: now.join("; ") || state.handoff?.progress || "", next: (ctx.task && ctx.task.title) || next[0] || state.handoff?.next || "", blockers: (ctx.block || []).join("; ") || "none", avoid: state.handoff?.avoid || "Не выдумывать прогресс. Не плодить вторую базу." };
  }
  function grokPrompt(state, ctx) {
    const p = pname(state, state.state?.activeProject);
    const step = ctx.task ? ctx.task.title : "уточни следующий шаг у пользователя";
    return ["Ты следующий агент штаба. Сначала прочитай состояние, не восстанавливай чат по памяти.", `Активный проект: ${p}.`, `Роль на этот ход: ${aname(state, ctx.chosen)}.`, `Мысль мозга: ${ctx.thought}`, `Сделай только этот шаг: ${step}.`, "Потом обнови HANDOFF: сделано / не сделано / дальше / блокеры / не повторять.", "Не выдумывай репозитории и прогресс игр."].join(" ");
  }
  function tick(state) {
    const idea = think(state);
    const next = structuredClone(state);
    next.brain = next.brain || {};
    next.brain.lastThought = idea.thought;
    next.brain.lastVerdict = idea.verdict;
    next.brain.lastAgent = idea.agentId;
    next.brain.updated = new Date().toISOString();
    if (idea.task && idea.verdict !== "blocked") {
      next.tasks = (next.tasks || []).map(t => t.id === idea.task.id ? { ...t, lane: "now", agent: idea.agentId } : (t.lane === "now" && t.id !== idea.task.id ? { ...t, lane: "next" } : t));
      next.agents = (next.agents || []).map(a => a.id === idea.agentId ? { ...a, status: "work" } : (a.status === "work" ? { ...a, status: "on" } : a));
      next.state = { ...next.state, phase: "мозг назначил ход", goal: idea.task.title };
    }
    next.handoff = { ...next.handoff, ...idea.packet };
    next.log = [{ t: stamp(), text: `Мозг: ${idea.thought}` }, ...(next.log || [])].slice(0, 40);
    return { state: next, idea };
  }
  function stamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} +05`;
  }
  function compress(state) {
    return { updated: state.updated, active: state.state, agents: (state.agents || []).map(a => `${a.id}:${a.status}`), now: (state.tasks || []).filter(t => t.lane !== "done").map(t => `${t.lane}:${t.title}`), handoff: state.handoff, thought: state.brain?.lastThought || "" };
  }
  root.HQBrain = { CONSTITUTION, route, think, tick, compileHandoff, compress, grokPrompt };
})(window);
