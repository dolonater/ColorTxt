import type * as monaco from "monaco-editor";
import {
  buildTxtrCustomHighlightMonarchRules,
  type TxtrMonarchHighlightOptions,
} from "./txtrHighlightMonarch";

export type { TxtrMonarchHighlightOptions };

/**
 * 不含成对括号开符（由 root 中优先匹配并进入 string/bracket 状态）。
 * 保留闭符与独立标点，便于未配对时在 root 仍显示为标点。
 */
const PUNCTUATION_CLASS = /[,，.。!！?？:：;；、）\]\}｝】〗》＞>…—\-]/;

/**
 * 拉丁词：ASCII、全角拉丁（U+FF21–FF3A、U+FF41–FF5A）及 Unicode 中标注为拉丁文的字母
 *（含拼音声调 ā/ō/ē/ǎ 等）；允许字母后紧跟结合变音标记（NFC/NFD 均可）。
 */
const LATIN_WORD = /(?:\p{Script=Latin}(?:\p{M})*)+/u;

const NUMBER = /[0-9０-９]+/;
const SPECIAL_MARKERS = /[·•▪*＊✲❈※☆♡♥○●√✔☑×✘☒]/;

/** 在否定字符类中需要转义的闭括号字符 */
function escapeForNegatedClass(closeChar: string): string {
  if (closeChar === "]") return "\\]";
  if (closeChar === "\\") return "\\\\";
  if (closeChar === "-") return "\\-";
  if (closeChar === "^") return "\\^";
  return closeChar;
}

/**
 * 兜底：不含闭符、换行、数字、拉丁（含全角拉丁）。
 * 这里必须“单字符推进”而非 `+` 贪婪段匹配，否则会把「前缀+关键词」整段吞掉，
 * 使关键词规则（txtr.customHighlight.*）无法在中间位置命中。
 * 引号内额外排除括号开符，保证 `《…》` 能进入 bracket 子状态。
 */
function innerRestRe(
  closeChar: string,
  stopBeforeBracketOpeners: boolean,
): RegExp {
  const e = escapeForNegatedClass(closeChar);
  const noBracketOpen =
    stopBeforeBracketOpeners
      ? "《<＜（【〖｛\\[\\(\\{"
      : "";
  return new RegExp(
    `[^${e}\\r\\n0-9\\p{Script=Latin}${noBracketOpen}]`,
    "u",
  );
}

/** 与 root 一致；在引号内须排在自定义高亮词之后，避免 `《` 抢在关键词匹配之前进入括号状态 */
function bracketOpenerRules(): monaco.languages.IMonarchLanguageRule[] {
  return [
    [/《/, { token: "txtr.punctuation", next: "bracketBook" }],
    [/</, { token: "txtr.punctuation", next: "bracketAngleAscii" }],
    [/＜/, { token: "txtr.punctuation", next: "bracketAngleFull" }],
    [/\(/, { token: "txtr.punctuation", next: "bracketParenAscii" }],
    [/（/, { token: "txtr.punctuation", next: "bracketParenFull" }],
    [/\[/, { token: "txtr.punctuation", next: "bracketSquareAscii" }],
    [/【/, { token: "txtr.punctuation", next: "bracketCjk" }],
    [/〖/, { token: "txtr.punctuation", next: "bracketFancy" }],
    [/\{/, { token: "txtr.punctuation", next: "bracketCurlyAscii" }],
    [/｛/, { token: "txtr.punctuation", next: "bracketCurlyFull" }],
  ];
}

/**
 * 引号/括号内侧：自定义高亮词优先于引号/括号内侧兜底；引号内再在关键词之后尝试括号开符，以便「《书名》」仍为 bracketInner。
 * 数字、英文、标点优先于 innerRest；txtr.quoteInner / txtr.bracketInner 仅兜底（优先级最低）。
 */
function rulesInsideDelimited(
  closeMatch: RegExp,
  closeChar: string,
  innerToken: "txtr.quoteInner" | "txtr.bracketInner",
  highlightRules: monaco.languages.IMonarchLanguageRule[],
  /** 仅 true：在引号内于高亮词之后匹配成对括号开符 */
  bracketOpenersInQuote = false,
): monaco.languages.IMonarchLanguageRule[] {
  return [
    [/[\r\n]/, { token: "", next: "@pop" }],
    ...highlightRules,
    ...(bracketOpenersInQuote ? bracketOpenerRules() : []),
    [closeMatch, { token: "txtr.punctuation", next: "@pop" }],
    [SPECIAL_MARKERS, "txtr.specialMarker"],
    [NUMBER, "txtr.number"],
    [LATIN_WORD, "txtr.english"],
    [PUNCTUATION_CLASS, "txtr.punctuation"],
    [
      innerRestRe(closeChar, bracketOpenersInQuote),
      innerToken,
    ],
  ];
}

/**
 * `includeLF: true` 时行尾 \\n 可匹配，未闭合的引号/括号在换行处 @pop（不跨行）。
 * `includeLF: false` 时成对符号可跨行（由设置「引号/括号匹配支持跨行」与「内容上色」共同决定）。
 * 标点 token 仅在 root 匹配；引号内为 txtr.quoteInner；成对括号内为 txtr.bracketInner。
 * root 先括号开符再关键词；引号内先关键词再括号开符，故关键词优先于引号内侧、括号开符仍优先于纯引号内兜底。
 */
export function createTxtrTextMonarchLanguage(
  highlight?: TxtrMonarchHighlightOptions,
  /** 为 true 时成对引号/括号可跨行（Monarch includeLF: false） */
  delimitedMatchCrossLine = false,
): monaco.languages.IMonarchLanguage {
  const hl =
    highlight ?? {
      enabled: false,
      highlightColorsLength: 0,
      highlightWordsByIndex: undefined,
    };
  const hlRules = buildTxtrCustomHighlightMonarchRules(hl);
  const crossLineEffective = Boolean(hl.enabled) && delimitedMatchCrossLine;

  return {
    defaultToken: "",
    /** 见文件头注释：仅「内容上色」且开启跨行时为 false */
    includeLF: !crossLineEffective,
    tokenizer: {
      root: [
        ...bracketOpenerRules(),
        [/"/, { token: "txtr.punctuation", next: "stringDouble" }],
        [/'/, { token: "txtr.punctuation", next: "stringSingle" }],
        [/「/, { token: "txtr.punctuation", next: "stringCorner" }],
        [/『/, { token: "txtr.punctuation", next: "stringWhite" }],
        [/\u201C/, { token: "txtr.punctuation", next: "stringLdquo" }],
        [/\u2018/, { token: "txtr.punctuation", next: "stringLsquo" }],
        ...hlRules,
        [SPECIAL_MARKERS, "txtr.specialMarker"],
        [NUMBER, "txtr.number"],
        [LATIN_WORD, "txtr.english"],
        [PUNCTUATION_CLASS, "txtr.punctuation"],
        [/./, ""],
      ],

      stringDouble: rulesInsideDelimited(/"/, '"', "txtr.quoteInner", hlRules, true),

      stringSingle: rulesInsideDelimited(/'/, "'", "txtr.quoteInner", hlRules, true),

      stringCorner: rulesInsideDelimited(/」/, "」", "txtr.quoteInner", hlRules, true),

      stringWhite: rulesInsideDelimited(/』/, "』", "txtr.quoteInner", hlRules, true),

      stringLdquo: rulesInsideDelimited(
        /\u201D/,
        "\u201D",
        "txtr.quoteInner",
        hlRules,
        true,
      ),

      stringLsquo: rulesInsideDelimited(
        /\u2019/,
        "\u2019",
        "txtr.quoteInner",
        hlRules,
        true,
      ),

      bracketBook: rulesInsideDelimited(/》/, "》", "txtr.bracketInner", hlRules),

      bracketAngleAscii: rulesInsideDelimited(
        />/,
        ">",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketAngleFull: rulesInsideDelimited(
        /＞/,
        "＞",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketParenAscii: rulesInsideDelimited(
        /\)/,
        ")",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketParenFull: rulesInsideDelimited(
        /）/,
        "）",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketSquareAscii: rulesInsideDelimited(
        /\]/,
        "]",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketCjk: rulesInsideDelimited(/】/, "】", "txtr.bracketInner", hlRules),

      bracketFancy: rulesInsideDelimited(/〗/, "〗", "txtr.bracketInner", hlRules),

      bracketCurlyAscii: rulesInsideDelimited(
        /\}/,
        "}",
        "txtr.bracketInner",
        hlRules,
      ),

      bracketCurlyFull: rulesInsideDelimited(
        /｝/,
        "｝",
        "txtr.bracketInner",
        hlRules,
      ),
    },
  };
}
