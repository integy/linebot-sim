// Blockly block definitions (Chinese labels) + a small async JS emitter.
// The emitter walks blocks itself so every loop can `await` a simulation frame.

const C = {
  motion: "#1f6f8b",
  sense: "#2f7d5d",
  control: "#8a5a1f",
  math: "#4a4a86",
};

function defs() {
  const B = [
    {
      type: "bot_motors",
      message0: "馬達 左 %1 右 %2",
      args0: [
        { type: "input_value", name: "L", check: "Number" },
        { type: "input_value", name: "R", check: "Number" },
      ],
      previousStatement: null, nextStatement: null, colour: C.motion,
      tooltip: "設定左右馬達速度，-100 至 100",
    },
    {
      type: "bot_left",
      message0: "左馬達 %1",
      args0: [{ type: "input_value", name: "V", check: "Number" }],
      previousStatement: null, nextStatement: null, colour: C.motion,
    },
    {
      type: "bot_right",
      message0: "右馬達 %1",
      args0: [{ type: "input_value", name: "V", check: "Number" }],
      previousStatement: null, nextStatement: null, colour: C.motion,
    },
    {
      type: "bot_stop",
      message0: "停車",
      previousStatement: null, nextStatement: null, colour: C.motion,
    },
    {
      type: "bot_wait",
      message0: "等待 %1 ms",
      args0: [{ type: "input_value", name: "MS", check: "Number" }],
      previousStatement: null, nextStatement: null, colour: C.motion,
    },
    {
      type: "bot_sensor",
      message0: "感測器 %1 讀值",
      args0: [{
        type: "field_dropdown", name: "S",
        options: [["1", "0"], ["2", "1"], ["3", "2"], ["4", "3"], ["5", "4"], ["6", "5"], ["7", "6"]],
      }],
      output: "Number", colour: C.sense,
      tooltip: "0 = 全白，100 = 全黑（感測器 1 在最左）",
    },
    {
      type: "bot_on",
      message0: "感測器 %1 見到黑線",
      args0: [{
        type: "field_dropdown", name: "S",
        options: [["1", "0"], ["2", "1"], ["3", "2"], ["4", "3"], ["5", "4"], ["6", "5"], ["7", "6"]],
      }],
      output: "Boolean", colour: C.sense,
    },
    {
      type: "bot_error",
      message0: "黑線位置 (-3…+3)",
      output: "Number", colour: C.sense,
      tooltip: "負數 = 線在左邊，正數 = 線在右邊，0 = 正中",
    },
    {
      type: "bot_lost",
      message0: "失去黑線？",
      output: "Boolean", colour: C.sense,
    },
    {
      type: "bot_laps",
      message0: "已完成圈數",
      output: "Number", colour: C.sense,
    },
    {
      type: "bot_time",
      message0: "已用時間（秒）",
      output: "Number", colour: C.sense,
    },
  ];
  const define = Blockly.common?.defineBlocksWithJsonArray || Blockly.defineBlocksWithJsonArray;
  define.call(Blockly.common || Blockly, B);
}

/* ---------------- emitter ---------------- */

const NUM = (b, def = 0) => (b ? expr(b) : String(def));

function expr(b) {
  if (!b) return "0";
  switch (b.type) {
    case "math_number": return String(Number(b.getFieldValue("NUM") ?? 0));
    case "math_arithmetic": {
      const op = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "**" }[b.getFieldValue("OP")];
      return `(${NUM(b.getInputTargetBlock("A"))} ${op} ${NUM(b.getInputTargetBlock("B"))})`;
    }
    case "math_single": {
      const op = b.getFieldValue("OP");
      const v = NUM(b.getInputTargetBlock("NUM"));
      if (op === "ABS") return `Math.abs(${v})`;
      if (op === "NEG") return `(-${v})`;
      if (op === "ROOT") return `Math.sqrt(${v})`;
      return v;
    }
    case "math_modulo":
      return `(${NUM(b.getInputTargetBlock("DIVIDEND"))} % ${Math.max(1, Number(NUM(b.getInputTargetBlock("DIVISOR"))) || 1)})`;
    case "math_random_int":
      return `(Math.floor(Math.random() * (${NUM(b.getInputTargetBlock("TO"))} - ${NUM(b.getInputTargetBlock("FROM"))} + 1)) + ${NUM(b.getInputTargetBlock("FROM"))})`;
    case "logic_compare": {
      const op = { EQ: "===", NEQ: "!==", LT: "<", LTE: "<=", GT: ">", GTE: ">=" }[b.getFieldValue("OP")];
      return `(${expr(b.getInputTargetBlock("A"))} ${op} ${expr(b.getInputTargetBlock("B"))})`;
    }
    case "logic_operation": {
      const op = b.getFieldValue("OP") === "AND" ? "&&" : "||";
      return `(${expr(b.getInputTargetBlock("A"))} ${op} ${expr(b.getInputTargetBlock("B"))})`;
    }
    case "logic_negate": return `(!${expr(b.getInputTargetBlock("BOOL"))})`;
    case "logic_boolean": return b.getFieldValue("BOOL") === "TRUE" ? "true" : "false";
    case "bot_sensor": return `bot.sensor(${b.getFieldValue("S")})`;
    case "bot_on": return `bot.onLine(${b.getFieldValue("S")})`;
    case "bot_error": return "(bot.lineError() ?? 0)";
    case "bot_lost": return "bot.lost()";
    case "bot_laps": return "bot.laps()";
    case "bot_time": return "bot.time()";
    case "variables_get": return varName(b, b.getFieldValue("VAR"));
    case "math_number_property": return "0";
    default: return "0";
  }
}

const varName = (b, id) => "v_" + String(id).replace(/[^A-Za-z0-9_]/g, "_");

function stmt(b, ind, out) {
  if (!b) return;
  const pad = "  ".repeat(ind);
  switch (b.type) {
    case "bot_motors":
      out.push(`${pad}bot.setMotors(${NUM(b.getInputTargetBlock("L"))}, ${NUM(b.getInputTargetBlock("R"))});`);
      break;
    case "bot_left":
      out.push(`${pad}bot.setLeft(${NUM(b.getInputTargetBlock("V"))});`);
      break;
    case "bot_right":
      out.push(`${pad}bot.setRight(${NUM(b.getInputTargetBlock("V"))});`);
      break;
    case "bot_stop":
      out.push(`${pad}bot.setMotors(0, 0);`);
      break;
    case "bot_wait":
      out.push(`${pad}await bot.wait(${NUM(b.getInputTargetBlock("MS"), 500)});`);
      break;
    case "controls_repeat_ext": {
      const n = NUM(b.getInputTargetBlock("TIMES"), 10);
      out.push(`${pad}for (let i_${ind} = 0; i_${ind} < (${n}); i_${ind}++) {`);
      stmt(b.getInputTargetBlock("DO"), ind + 1, out);
      out.push(`${pad}  await y();`);
      out.push(`${pad}}`);
      break;
    }
    case "controls_whileUntil": {
      const mode = b.getFieldValue("MODE");
      const cond = expr(b.getInputTargetBlock("BOOL"));
      out.push(`${pad}while (${mode === "UNTIL" ? `!(${cond})` : cond}) {`);
      stmt(b.getInputTargetBlock("DO"), ind + 1, out);
      out.push(`${pad}  await y();`);
      out.push(`${pad}}`);
      break;
    }
    case "controls_if": {
      const n = b.elseifCount_ || 0;
      for (let i = 0; i <= n; i++) {
        const c = expr(b.getInputTargetBlock("IF" + i));
        out.push(`${pad}${i === 0 ? "if" : "else if"} (${c}) {`);
        stmt(b.getInputTargetBlock("DO" + i), ind + 1, out);
        out.push(`${pad}}`);
      }
      if (b.elseCount_) {
        out.push(`${pad}else {`);
        stmt(b.getInputTargetBlock("ELSE"), ind + 1, out);
        out.push(`${pad}}`);
      }
      break;
    }
    case "variables_set":
      out.push(`${pad}${varName(b, b.getFieldValue("VAR"))} = ${NUM(b.getInputTargetBlock("VALUE"))};`);
      break;
    case "math_change":
      out.push(`${pad}${varName(b, b.getFieldValue("VAR"))} += ${NUM(b.getInputTargetBlock("DELTA"))};`);
      break;
    default:
      // a value block dropped on the stack: evaluate for side effects (none)
      out.push(`${pad}void (${expr(b)});`);
  }
  stmt(b.getNextBlock(), ind, out);
}

export function compileWorkspace(workspace) {
  const out = [];
  const vars = (workspace.getVariableMap?.()?.getAllVariables?.() ?? workspace.getAllVariables?.() ?? []);
  for (const v of vars) out.push(`let ${varName(null, v.getId())} = 0;`);

  const tops = workspace.getTopBlocks(true).filter((b) => b.previousConnection);
  if (!tops.length) return { code: "", error: "未有積木程式" };
  for (const t of tops) stmt(t, 0, out);

  const code = out.join("\n");
  return { code, error: null, vars: vars.length };
}

export function registerBlocks() {
  defs();
}

export function toolbox() {
  const num = (v) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category", name: "動作", colour: C.motion,
        contents: [
          { kind: "block", type: "bot_motors", inputs: { L: num(60), R: num(60) } },
          { kind: "block", type: "bot_left", inputs: { V: num(60) } },
          { kind: "block", type: "bot_right", inputs: { V: num(60) } },
          { kind: "block", type: "bot_stop" },
          { kind: "block", type: "bot_wait", inputs: { MS: num(500) } },
        ],
      },
      {
        kind: "category", name: "感測", colour: C.sense,
        contents: [
          { kind: "block", type: "bot_sensor" },
          { kind: "block", type: "bot_on" },
          { kind: "block", type: "bot_error" },
          { kind: "block", type: "bot_lost" },
          { kind: "block", type: "bot_laps" },
          { kind: "block", type: "bot_time" },
        ],
      },
      {
        kind: "category", name: "控制", colour: C.control,
        contents: [
          { kind: "block", type: "controls_if" },
          { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: num(4) } },
          { kind: "block", type: "controls_whileUntil" },
        ],
      },
      {
        kind: "category", name: "邏輯", colour: C.control,
        contents: [
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
        ],
      },
      {
        kind: "category", name: "數學", colour: C.math,
        contents: [
          { kind: "block", type: "math_number" },
          { kind: "block", type: "math_arithmetic" },
          { kind: "block", type: "math_modulo" },
          { kind: "block", type: "math_single" },
        ],
      },
      { kind: "category", name: "變數", colour: "#a0505e", custom: "VARIABLE" },
    ],
  };
}