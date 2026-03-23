# Knowledge Graph Hook System — Deep Dive Report

## Bối cảnh: Vấn đề cần giải quyết

Knowledge Graph (KG) MCP server lưu trữ domain knowledge — business rules, workflow rationale, domain constraints — dưới dạng graph database với semantic embeddings. Claude Code tương tác với KG qua 8 MCP tools: `knowledge_store`, `knowledge_query`, `knowledge_list`, `knowledge_evolve`, `knowledge_validate`, `knowledge_promote`, `knowledge_link`, `knowledge_delete`.

Vấn đề: Claude là một LLM — nó có xu hướng hành động nhanh mà bỏ qua quy trình. Cụ thể:

- **Store mà không check trùng**: Claude store chunk mới mà không gọi `knowledge_list` trước, tạo domain fragmentation (ví dụ: "di" và "dependency-injection" là hai domain khác nhau cho cùng một topic).
- **Store fact từ code inference**: Claude đọc code, suy ra business rule, rồi store thẳng dưới dạng "fact" — mà không hỏi user xác nhận. Điều này vi phạm interview protocol: insights từ code phải bắt đầu là "insight" với confidence thấp, được user confirm trước khi evolve thành "fact".
- **Promote thiếu evidence**: Claude promote chunk lên lifecycle cao hơn mà không cite đủ 4 golden evidence sources (docs, code, tests, task tracking).
- **Validate không evidence**: Claude confirm/refute chunk mà không ghi lại evidence — không ai biết tại sao confidence thay đổi.
- **Mất context sau compaction**: Khi session dài, Claude Code compact context window — Claude mất toàn bộ domain knowledge đã query, phải bắt đầu lại từ đầu.
- **Tool fail không guidance**: Khi KG daemon down hoặc Ollama offline, Claude nhận raw error message mà không biết cách fix.
- **Marker files không cleanup**: Session state (marker files trong /tmp) accumulate mà không bao giờ được dọn.

Giải pháp: 11 enforcement hooks — bash scripts chạy tại các lifecycle events của Claude Code, biến soft instructions thành hard system-level enforcement.

---

## Claude Code Hook System: Cách hoạt động

Claude Code hỗ trợ 22 hook events trải dài toàn bộ lifecycle của một session. Mỗi event cho phép đăng ký bash scripts (hoặc HTTP endpoints, LLM prompts, hoặc subagents) chạy tự động khi event fire.

### Cơ chế giao tiếp giữa hook và Claude Code

Hooks nhận JSON input qua stdin và giao tiếp ngược lại qua 3 kênh:

**Kênh 1: Exit code**
- `exit 0`: Thành công. Claude Code parse stdout cho JSON output.
- `exit 2`: Blocking error. Claude Code bỏ qua stdout, lấy stderr feed ngược lại cho Claude như error message. Claude sẽ thấy error, hiểu mình bị chặn, và sửa input để retry.
- `exit 1` hoặc khác: Non-blocking error. stderr hiện ở verbose mode. Execution tiếp tục.

**Kênh 2: Structured JSON output (stdout)**
Khi exit 0, hook có thể output JSON với `hookSpecificOutput.additionalContext` — text này được Claude Code inject trực tiếp vào context window của Claude, như thể system message. Claude xử lý nó như input chính thức, không phải side note.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Text injected vào Claude's context"
  }
}
```

**Kênh 3: stderr (for exit 2)**
Khi exit 2, stderr content được feed ngược lại cho Claude. Claude đọc error message, hiểu vì sao bị block, và sửa tool call.

### Matcher system

Mỗi hook registration có `matcher` field — regex string xác định khi nào hook fire:

- `"mcp__knowledge-graph__knowledge_store"` — chỉ fire cho tool cụ thể
- `"mcp__knowledge-graph__.*"` — fire cho tất cả KG tools
- `""` — fire cho tất cả (hoặc cho events không support matcher)

Một số events match trên fields khác nhau:
- PreToolUse/PostToolUse: match trên `tool_name`
- SessionStart: match trên `source` (startup, resume, compact, clear)
- SessionEnd: match trên `reason` (logout, clear, etc.)

### Settings configuration

Hook registrations sống trong `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__knowledge-graph__knowledge_store",
        "hooks": [
          {"type": "command", "command": ".claude/hooks/kg-require-domain-check.sh"},
          {"type": "command", "command": ".claude/hooks/kg-source-category-check.sh"}
        ]
      }
    ]
  }
}
```

Nhiều hooks có thể share cùng một matcher — chúng chạy parallel. Nhiều matchers có thể tồn tại cho cùng một event.

---

## Kiến trúc tổng quan: 3 Lớp bảo vệ

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SESSION LIFECYCLE                            │
│                                                                     │
│  SessionStart ──────── User works ──────── Stop ──── SessionEnd    │
│       │                     │                │            │         │
│       ▼                     ▼                ▼            ▼         │
│  ┌─────────┐         ┌───────────┐    ┌──────────┐  ┌─────────┐   │
│  │ Layer 2 │         │  Layer 1  │    │ Layer 3  │  │ Layer 3 │   │
│  │ Context │         │  Policy   │    │ Reminder │  │ Cleanup │   │
│  │ Inject  │         │  Gates    │    │          │  │         │   │
│  └─────────┘         └───────────┘    └──────────┘  └─────────┘   │
│                            │                                        │
│                     ┌──────┴──────┐                                 │
│                     ▼             ▼                                  │
│               PreToolUse    PostToolUse                              │
│               (4 hooks)     (3 hooks, audit covers 6 tools)         │
│               BLOCK/ALLOW   TRACK/LOG                               │
│                     │                                               │
│                     ▼                                                │
│              PostToolUseFailure                                      │
│              (1 hook) RECOVER                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Lớp 1: Policy Gates — 4 PreToolUse hooks

Chặn tool call trước khi execute. Dùng exit 2 + stderr feedback. Claude bị block, đọc error, sửa, retry.

### Lớp 2: Intelligence Layer — 2 hooks (SessionStart, PostToolUseFailure)

Inject context vào Claude's context window qua JSON additionalContext. Claude nhận information, không bị block.

### Lớp 3: Tracking & Cleanup — 5 hooks (PostToolUse, Stop, SessionEnd)

Side effects: marker files, audit log, gentle reminders, cleanup. Không block, không inject context mạnh.

---

## Chi tiết từng hook

---

### Hook 1: `kg-require-domain-check.sh`

**Event**: PreToolUse
**Matcher**: `mcp__knowledge-graph__knowledge_store`
**Cơ chế**: Exit 2 blocking

**Vấn đề giải quyết**: Domain fragmentation. Claude store chunk mới mà không biết domain nào đã tồn tại. Kết quả: "di", "dependency-injection", "DI", "injection" — 4 domains cho cùng 1 topic. Search bị phân mảnh, auto-linking không hoạt động qua domain boundaries.

**Cách hoạt động**:
1. Hook check marker file `kg-domains-checked-{session_id}` trong temp directory
2. Nếu marker tồn tại → exit 0 (cho qua, vì Claude đã gọi `knowledge_list` trong session này)
3. Nếu marker không tồn tại → exit 2 với message: "BLOCKED: Call knowledge_list first"
4. Claude đọc error, gọi `knowledge_list`, hook `kg-mark-domains-checked.sh` (PostToolUse) tạo marker
5. Claude retry store → lần này marker tồn tại → cho qua

**Tận dụng hệ thống**: Exit 2 block + stderr feedback loop. Claude tự sửa hành vi mà user không cần can thiệp. Marker file pattern tạo "memory" xuyên suốt session — check 1 lần, qua suốt session.

**Interaction chain**: Hook này phụ thuộc vào `kg-mark-domains-checked.sh` (Hook 7) để tạo marker. Đây là cặp hook cooperating: 1 gate, 1 enabler.

---

### Hook 2: `kg-source-category-check.sh`

**Event**: PreToolUse
**Matcher**: `mcp__knowledge-graph__knowledge_store` VÀ `mcp__knowledge-graph__knowledge_evolve`
**Cơ chế**: Exit 2 blocking

**Vấn đề giải quyết**: Interview protocol violation. KG có 5 category: fact, rule, insight, question, workflow. Mỗi category có quy tắc về source provenance:

- `insight` và `question`: BẮT BUỘC có source (ví dụ: `user-confirmed:withdrawal flow`, `observed:code pattern`). Vì đây là những thứ Claude suy ra, cần traceability.
- `fact`, `rule`, `workflow`: CẤM source là `observed:*` hoặc `code-review:*`. Nếu Claude infer từ code, phải store là `insight` trước, hỏi user xác nhận, rồi evolve thành `fact`.

**Cách hoạt động**:
1. Parse `tool_name` để xác định đang xử lý store hay evolve
2. Với evolve: check `new_metadata` — nếu không thay đổi category thì skip (giữ policy của chunk gốc)
3. Với store: check `metadata.category` và `metadata.source`
4. Apply policy matrix:
   - insight/question + no source → BLOCK
   - insight/question + invalid source prefix → BLOCK
   - fact/rule/workflow + observed:*/code-review:* → BLOCK
   - Tất cả còn lại → ALLOW

**Tận dụng hệ thống**: Cùng 1 hook script đăng ký cho 2 matchers khác nhau (knowledge_store và knowledge_evolve). Hook parse `tool_name` từ input JSON để phân biệt và xử lý metadata path khác nhau (`.metadata` vs `.new_metadata`). Đây là ví dụ của hook multiplexing — 1 script, nhiều tools.

**Thiết kế đáng chú ý**: Hook cho evolve SKIP nếu evolve không thay đổi category — vì nếu content thay đổi mà category giữ nguyên, policy đã được enforce lúc store ban đầu. Chỉ khi category thay đổi (ví dụ: insight → fact) thì cần re-validate source compatibility.

**Drift fix (v2)**: Hook cũ kiểm tra cả `source` cho evolve, nhưng `knowledge_evolve` schema trong `client.ts` KHÔNG có `source` field — đây là dead code. Đã sửa: evolve branch chỉ check category, skip source. Nếu evolve category thành `insight` hoặc `question` → BLOCK (phải dùng `knowledge_store` với proper source). Source check chỉ còn cho `knowledge_store`.

---

### Hook 3: `kg-require-golden-evidence.sh`

**Event**: PreToolUse
**Matcher**: `mcp__knowledge-graph__knowledge_promote`
**Cơ chế**: Exit 2 blocking

**Vấn đề giải quyết**: Premature promotion. KG có lifecycle: hypothesis → validated → promoted → canonical. Promotion yêu cầu verification từ 4 "golden evidence" sources: documentation, source code, tests, task tracking. Claude có xu hướng promote nhanh mà bỏ qua verification.

**Cách hoạt động**:
1. Parse `reason` field từ tool input
2. grep kiểm tra 4 patterns: `[docs:`, `[code:`, `[tests:`, `[task:`
3. Nếu thiếu bất kỳ pattern nào → BLOCK với danh sách cụ thể những gì thiếu
4. Format yêu cầu: `Golden Evidence: [docs:path] [code:path:line] [tests:path] [task:issue-id]`

**Ví dụ reason hợp lệ**:
```
Golden Evidence: [docs:CLAUDE.md] [code:src/engine/retriever.ts:55] [tests:scripts/regression-test.ts] [task:KG-42]
```

**Ví dụ reason bị block**:
```
This knowledge has been confirmed multiple times
→ BLOCKED: Missing [docs:] [code:] [tests:] [task:]
```

**Tận dụng hệ thống**: grep pattern matching trên structured text. Hook không kiểm tra paths có valid hay không — chỉ kiểm tra format. Validation depth nằm ở Claude's judgment (Claude phải thực sự verify trước khi compose reason), hook chỉ enforce format discipline.

---

### Hook 4: `kg-require-validate-evidence.sh`

**Event**: PreToolUse
**Matcher**: `mcp__knowledge-graph__knowledge_validate`
**Cơ chế**: Exit 2 blocking

**Vấn đề giải quyết**: Untraced validation. `knowledge_validate` thay đổi confidence score của chunk (confirm tăng, refute giảm). Nếu không có evidence, không ai biết tại sao confidence thay đổi — audit trail bị đứt.

**Cách hoạt động**:
1. Parse `evidence` field từ tool input
2. Nếu empty → BLOCK
3. Gợi ý prefixes: `user:`, `docs:`, `code:`, `tests:`, `task:`

**Tận dụng hệ thống**: Đơn giản nhất trong 4 gate hooks. Chỉ check non-empty. Nhưng impact lớn: mỗi validation action giờ đây có citation — cho phép truy vết ngược từ confidence score về evidence source.

---

### Hook 5: `kg-session-start.sh`

**Event**: SessionStart
**Matcher**: Không có (SessionStart không hỗ trợ matcher — luôn fire)
**Cơ chế**: JSON `additionalContext` injection

**Vấn đề giải quyết**: Session amnesia. Mỗi session mới, Claude không biết KG tồn tại trừ khi được nhắc. Đặc biệt sau compaction, Claude mất toàn bộ domain context đã query.

**Lịch sử thiết kế**: Đây là hook thay thế `kg-session-query-reminder.sh` cũ. Hook cũ dùng `UserPromptSubmit` event + marker file trong `/tmp` để "fire 1 lần per session". Vấn đề:
- Marker file hack: phải tạo file, check file, không cleanup
- `UserPromptSubmit` fire mỗi khi user gửi prompt — phải tự track đã fire chưa
- Output bằng raw text (cat heredoc) — không structured

Hook mới dùng `SessionStart` — fire đúng 1 lần khi session bắt đầu, tự nhiên theo lifecycle. Không cần marker file.

**Cách hoạt động**:
1. Parse `source` field từ input JSON — Claude Code cung cấp lý do session bắt đầu
2. Branch theo 4 cases:

**Case `startup` — Session hoàn toàn mới**:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "[Knowledge Graph] New session. Query knowledge_list then knowledge_query with relevant domain terms before storing new domain knowledge. This prevents duplicates and ensures consistency with previously captured business rules."
  }
}
```
Claude nhận instruction rõ ràng: list trước, query sau, rồi mới store.

**Case `compact` — Context vừa bị compact**:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "[Knowledge Graph] Context was compacted — domain knowledge may have been lost. Re-query knowledge_query with relevant domain terms to restore business rules and constraints before continuing work."
  }
}
```
Đây là case quan trọng nhất. Khi session dài, Claude Code tự động compact context window để tiết kiệm token. Sau compaction, Claude mất toàn bộ results từ các lần query KG trước đó. Hook inject nhắc nhở re-query — Claude recover domain context mà user không cần can thiệp.

**Case `resume` — Session được resume**:
Nhắc nhẹ refresh context nếu đang làm domain-related tasks.

**Case `clear` — User clear session**:
Xóa marker files (domains-checked, tool-used) cho session hiện tại, vì state cũ không còn relevant. Output message reset.

**Tận dụng hệ thống**:
- `SessionStart` event với `source` field — platform cung cấp ngữ cảnh tại sao session bắt đầu, hook react accordingly
- JSON `additionalContext` — text inject trực tiếp vào Claude's context window, được Claude xử lý như system input (không phải verbose-only log)
- Thay thế marker file pattern bằng native lifecycle — platform sở hữu "khi nào session bắt đầu", hook không cần tự track

**So sánh trước/sau**:
| Aspect | Cũ (UserPromptSubmit) | Mới (SessionStart) |
|--------|----------------------|---------------------|
| Fire frequency | Mỗi prompt (phải self-filter) | 1 lần per session start |
| State tracking | Marker file trong /tmp | Không cần |
| Context awareness | Không biết startup vs compact | Branch trên source |
| Output format | Raw text (cat heredoc) | Structured JSON additionalContext |
| Compact recovery | Không có | Tự động nhắc re-query |
| Cleanup | Không (marker tồn đọng) | Clear case xóa markers |

---

### Hook 6: `kg-tool-failure.sh`

**Event**: PostToolUseFailure
**Matcher**: `mcp__knowledge-graph__.*` (tất cả KG tools)
**Cơ chế**: JSON `additionalContext` injection

**Vấn đề giải quyết**: Blind failure. Khi KG tool fail (daemon down, Ollama offline, DB locked, project chưa init), Claude nhận raw error message. Claude không biết:
- Đây là lỗi tạm thời hay permanent
- User cần làm gì để fix
- Có nên retry hay không

**Cách hoạt động**:
1. Parse `error` field từ PostToolUseFailure input
2. Pattern matching phân loại lỗi:

| Error pattern | Root cause | Remediation |
|--------------|------------|-------------|
| `ECONNREFUSED`, `fetch failed`, `connection refused` | Daemon không chạy | `kg doctor` → `kg serve` |
| `no .knowledge-graph`, `not initialized` | Project chưa init | `kg init` |
| `ollama`, `embedding`, `bge-m3` | Ollama unavailable | `ollama serve` → `ollama pull bge-m3` |
| `lock`, `locked`, `busy`, `database` | DB bị lock | `kg stop` → `kg serve` |
| Không match | Unknown | `kg doctor` |

3. Output JSON `additionalContext` với hint + truncated error (max 200 chars)

**Tận dụng hệ thống**:
- `PostToolUseFailure` — event mới mà trước đây KG hooks không dùng. Fire khi tool fail (trả error), không phải khi tool succeed. Khác với `PostToolUse` (chỉ fire khi thành công).
- Non-blocking by design: tool đã fail rồi, hook không thể (và không cần) block gì. Chỉ inject guidance.
- `additionalContext` cho phép Claude tự suggest fix cho user: "KG daemon is not running. Try: kg doctor"

**Tại sao không dùng exit 2**: PostToolUseFailure không hỗ trợ blocking (exit 2 stderr chỉ hiện ở verbose mode). Đây là design choice của platform — tool đã fail, blocking không có ý nghĩa. Hook phải dùng additionalContext thay vì stderr.

**Ví dụ flow**:
```
1. Claude gọi knowledge_query("withdrawal rules")
2. Daemon không chạy → tool fail với "ECONNREFUSED 127.0.0.1:54321"
3. PostToolUseFailure fires → kg-tool-failure.sh
4. Hook classify: ECONNREFUSED → daemon down
5. Output: additionalContext = "[KG Recovery] KG daemon not running. Try: kg doctor, then kg serve"
6. Claude nhận context, nói với user: "KG daemon is not running. Run kg doctor to diagnose."
```

---

### Hook 7: `kg-mark-domains-checked.sh`

**Event**: PostToolUse
**Matcher**: `mcp__knowledge-graph__knowledge_list`
**Cơ chế**: Side-effect (marker file)

**Vai trò**: Enabler cho Hook 1 (`kg-require-domain-check.sh`). Khi `knowledge_list` được gọi thành công, hook tạo marker file `kg-domains-checked-{session_id}`. Hook 1 check marker này — nếu tồn tại, cho phép store.

**Cách hoạt động**:
```bash
touch "$MARKER_DIR/kg-domains-checked-${SESSION_ID}"
```

Một dòng lệnh. Nhưng impact lớn: tạo "proof of compliance" cho domain check gate.

**Marker file location**: `${TMPDIR}/claude-kg-hooks-$(id -u)/kg-domains-checked-{session_id}`
- `TMPDIR` hoặc `/tmp` — OS temp directory
- `$(id -u)` — user ID, tránh collision giữa users
- `session_id` — unique per session, tránh cross-session leaking
- Directory mode 700 — chỉ user hiện tại access được

---

### Hook 8: `kg-mark-tool-used.sh`

**Event**: PostToolUse
**Matcher**: Nhiều KG tools (knowledge_list, knowledge_store, knowledge_evolve, knowledge_query, knowledge_validate)
**Cơ chế**: Side-effect (marker file)

**Vai trò**: Enabler cho Hook 11 (`kg-learning-capture-check.sh`). Tạo marker `kg-tool-used-{session_id}` khi bất kỳ KG tool nào được dùng. Hook 11 (Stop) check marker — nếu không tồn tại, nhắc Claude capture learnings.

**Đăng ký cho nhiều matchers**: Hook này đăng ký 1 lần cho mỗi tool — 5 add_hook calls trong setup script. Mỗi matcher là tool name riêng biệt. Khi bất kỳ 1 tool fire, marker được tạo. Subsequent fires cho tools khác là no-op (touch lên file đã tồn tại).

---

### Hook 9: `kg-audit-log.sh`

**Event**: PostToolUse
**Matcher**: 6 tools — `knowledge_store`, `knowledge_evolve`, `knowledge_validate`, `knowledge_promote`, `knowledge_link`, `knowledge_delete`
**Cơ chế**: Side-effect (append-only JSONL log)

**Vấn đề giải quyết**: KG database chỉ lưu state cuối cùng. Không có history: chunk nào bị dedup? Ai store? Domain nào hay dùng? Category nào hay bị evolve? Ai validate/promote/delete? Tại sao confidence thay đổi?

**Cách hoạt động**:
1. Walk up từ CWD tìm `.knowledge-graph/` directory
2. Parse tool_name, tool_input và tool_result
3. Branch theo tool name, extract tool-specific fields:
   - **store**: action=store (hoặc dedup nếu `duplicate_of`), domain/category/source/summary/content_preview
   - **evolve**: domain/category/summary/content_preview
   - **validate**: validate_action (confirmed/refuted), evidence, confidence, lifecycle
   - **promote**: reason, previous_lifecycle, new_lifecycle, confidence
   - **link**: source_id, target_id, relation, description
   - **delete**: domain/category/lifecycle/summary (from snapshot), reason
4. Sanitize: newlines/tabs → spaces
5. Append JSONL entry vào `.knowledge-graph/audit.log`

**Format entries per tool**:
```json
{"timestamp":"...","action":"store","id":"abc-123","domain":"auth","category":"rule","source":"user-confirmed:...","summary":"...","content_preview":"..."}
{"timestamp":"...","action":"validate","id":"abc-123","validate_action":"confirmed","evidence":"code:src/auth.ts:42","confidence":"0.75","lifecycle":"active"}
{"timestamp":"...","action":"promote","id":"abc-123","reason":"Golden Evidence: [docs:...] [code:...] [tests:...] [task:...]","previous_lifecycle":"validated","new_lifecycle":"promoted","confidence":"0.9"}
{"timestamp":"...","action":"link","source_id":"abc-123","target_id":"def-456","relation":"depends_on","description":""}
{"timestamp":"...","action":"delete","id":"abc-123","domain":"auth","category":"rule","lifecycle":"promoted","summary":"...","reason":"Superseded by new compliance rule"}
```

**Tận dụng hệ thống**: PostToolUse cung cấp cả `tool_input` (input gốc) và `tool_result` (kết quả server trả). Hook dùng cả hai: input cho metadata, result cho state (confidence, lifecycle sau thay đổi).

**Dedup detection**: Khi `knowledge_store` trả `duplicate_of` field (similarity >= 0.88), hook log action là "dedup" thay vì "store". Cho phép analyze tần suất dedup — nếu nhiều, domain có thể cần reorganize.

**Delete snapshot**: `knowledge_delete` result bao gồm `snapshot` (domain, category, lifecycle, confidence, summary) — captured trước khi chunk bị xóa. Cho phép audit trail ngay cả khi chunk không còn trong database.

**Gitignored**: Audit log nằm trong `.knowledge-graph/` (đã gitignored). Local-only analytics.

---

### Hook 10: `kg-session-end-cleanup.sh`

**Event**: SessionEnd
**Matcher**: Không có (SessionEnd không hỗ trợ matcher — luôn fire)
**Cơ chế**: Side-effect (file deletion)

**Vấn đề giải quyết**: Marker file accumulation. Mỗi session tạo 2-3 marker files trong /tmp. Nếu không cleanup, /tmp tích tụ hàng trăm files nhỏ theo thời gian.

**Constraint quan trọng**: SessionEnd có default timeout **1.5 giây**. Nếu hook chạy quá lâu, Claude Code kill nó. Đây là design constraint từ platform — SessionEnd phải nhanh vì user đang đóng session.

**Thiết kế phản ứng với constraint**:
- **Không glob, không scan**: Hook KHÔNG dùng `rm $MARKER_DIR/kg-*-$SESSION_ID` (glob) mà liệt kê trực tiếp 3 file paths cụ thể
- **Không network**: Không gọi daemon, không gọi API
- **Không conditional logic**: Luôn rm -f, không check file exists trước
- **Luôn exit 0**: Không fail dù file không tồn tại

```bash
rm -f "$MARKER_DIR/kg-domains-checked-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-tool-used-${SESSION_ID}" 2>/dev/null
rm -f "$MARKER_DIR/kg-session-reminder-${SESSION_ID}" 2>/dev/null
```

3 lệnh rm. Mỗi lệnh ~1ms. Tổng cộng ~3ms — dư sức trong 1.5s budget.

**File thứ 3**: `kg-session-reminder-{session_id}` — legacy marker từ hook cũ (UserPromptSubmit). Cleanup cả cái này để handle migration gracefully.

---

### Hook 11: `kg-learning-capture-check.sh`

**Event**: Stop
**Matcher**: Không có (Stop không hỗ trợ matcher — luôn fire)
**Cơ chế**: stderr gentle reminder (KHÔNG BAO GIỜ block, luôn exit 0)

**Vấn đề giải quyết**: Silent knowledge loss. Claude làm xong task, tìm ra business rules, nhưng không capture vào KG. Domain knowledge mất theo session.

**Cách hoạt động**:
1. Check env var `KG_STOP_HOOK_ACTIVE` — nếu "1", exit ngay (chống infinite loop: Stop hook → Claude continues → Stop hook → ...)
2. Check marker file `kg-tool-used-{session_id}` — tạo bởi Hook 8
3. Nếu marker KHÔNG tồn tại → nhắc nhẹ qua stderr

**Tại sao KHÔNG block (exit 0, không phải exit 2)**:
- Stop hook với exit 2 sẽ CHẶN Claude dừng — Claude phải continue. Điều này rất intrusive.
- Nếu Claude session ngắn, không liên quan domain knowledge, việc bị chặn sẽ annoying.
- Design choice: gentle nudge > hard gate. User và Claude tự quyết có capture hay không.

**So sánh với Gate hooks**: Gate hooks (Layer 1) PHẢI block vì sai sẽ gây hại — store sai domain, promote thiếu evidence. Nhưng "quên capture" chỉ là missed opportunity, không phải damage. Mức enforcement phù hợp là reminder, không phải gate.

---

## Bảo mật: Temp File Isolation

Tất cả 11 hooks dùng chung pattern cho marker files:

```bash
MARKER_DIR="${TMPDIR:-/tmp}/claude-kg-hooks-$(id -u)"
mkdir -m 700 -p "$MARKER_DIR" 2>/dev/null
```

**Phân tích bảo mật**:
- `${TMPDIR:-/tmp}`: Dùng OS temp directory. macOS đặt TMPDIR vào per-user directory (`/var/folders/...`), isolate hơn `/tmp`.
- `$(id -u)`: Numeric user ID. Mỗi user có directory riêng.
- `mkdir -m 700`: Owner-only access (rwx------). Không user khác đọc/ghi được.
- `2>/dev/null`: Silent fail nếu directory đã tồn tại. Idempotent.

**Tại sao không dùng `/tmp` trực tiếp**: `/tmp` shared giữa users. Marker file name chứa session_id — có thể leak session existence cho users khác. User-scoped directory tránh information disclosure.

---

## Settings Merge: Idempotent Installation

`setup-hooks.sh` dùng `jq` để merge hook registrations vào `settings.local.json` mà KHÔNG mất content cũ.

**Helper function `add_hook`**:
```bash
add_hook() {
  local event="$1" matcher="$2" command="$3"
  SETTINGS=$(echo "$SETTINGS" | jq \
    --arg event "$event" \
    --arg matcher "$matcher" \
    --arg cmd "$command" '
    .hooks //= {} |
    .hooks[$event] //= [] |
    (.hooks[$event] | map(.matcher) | index($matcher)) as $idx |
    if $idx != null then
      if (.hooks[$event][$idx].hooks | map(.command) | index($cmd)) == null then
        .hooks[$event][$idx].hooks += [{"type": "command", "command": $cmd}]
      else . end
    else
      .hooks[$event] += [{"matcher": $matcher, "hooks": [{"type":"command","command":$cmd}]}]
    end
  ')
}
```

**Logic**:
1. Ensure `.hooks` và `.hooks[event]` tồn tại (tạo nếu chưa)
2. Tìm existing matcher entry — nếu có, thêm hook command vào array (nếu chưa có)
3. Nếu matcher chưa tồn tại, tạo entry mới
4. Idempotent: chạy lần 2 → không thêm duplicate

**Backup strategy**: Chỉ backup lần đầu. Lần 2+ không overwrite `.bak`:
```bash
if [ ! -f "${SETTINGS_FILE}.bak" ]; then
  cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak"
fi
```
Lý do: Backup bảo tồn pre-KG state. Nếu backup mỗi lần, lần 2 sẽ backup state đã có KG hooks — mất point of return.

---

## Migration: Từ Hook System Cũ

**Legacy**: 3 hook scripts ban đầu:
- `kg-require-domain-check.sh` (dùng `/tmp` trực tiếp)
- `kg-mark-domains-checked.sh` (dùng `/tmp` trực tiếp)
- `kg-require-golden-evidence.sh` (không cần markers)

**V1 expansion (9 hooks)**: Thêm 6 hooks mới, update 2 hooks cũ dùng `$MARKER_DIR`. Nhưng không tạo `kg-require-golden-evidence.sh` (assume đã tồn tại) → bug: project mới thiếu file → kg doctor báo 8/9.

**V2 current (11 hooks)**: Fix golden evidence bug + thêm 3 hooks mới (Phase 1) + migration logic:
- Tạo `kg-require-golden-evidence.sh` nếu chưa có
- Thay `kg-session-query-reminder.sh` bằng `kg-session-start.sh`
- Xóa old file và old settings registration
- Handle cả project cũ (có old hooks) và project mới (không có gì)

**Migration test verified**:
1. Project có old `kg-session-query-reminder.sh` + UserPromptSubmit settings → chạy setup → old file deleted, old settings removed, new file created, SessionStart registered
2. Project hoàn toàn mới → chạy setup → tất cả 11 hooks tạo mới
3. Chạy setup 2 lần → idempotent, 11 hooks, 6 events, không duplicate

---

## Execution Flow: Một Session Hoàn Chỉnh

```
╔══════════════════════════════════════════════════════════════════╗
║  SESSION START                                                    ║
║  SessionStart(source=startup)                                     ║
║  → kg-session-start.sh                                            ║
║  → inject: "Query KG before storing"                              ║
╚══════════════════════════════════════════════════════════════════╝
         │
         ▼
┌─── User asks about withdrawal flow ───────────────────────────────┐
│                                                                    │
│  Claude gọi knowledge_list()                                       │
│    PostToolUse → kg-mark-domains-checked.sh  ✓ domain đã check    │
│    PostToolUse → kg-mark-tool-used.sh        ✓ KG đã dùng        │
│                                                                    │
│  Claude gọi knowledge_query("withdrawal")                          │
│    PostToolUse → kg-mark-tool-used.sh        ✓ (đã mark)         │
│                                                                    │
│  Claude gọi knowledge_store({                                      │
│    category: "fact",                                               │
│    source: "user-confirmed: withdrawal flow",                      │
│    domain: "authentication", ...                                   │
│  })                                                                │
│    PreToolUse → kg-require-domain-check.sh   ✓ marker exists      │
│    PreToolUse → kg-source-category-check.sh  ✓ fact + user source │
│    PostToolUse → kg-audit-log.sh             📝 JSONL logged      │
│    PostToolUse → kg-mark-tool-used.sh        ✓ (đã mark)         │
│                                                                    │
│  Claude gọi knowledge_validate({                                   │
│    id: "abc-123",                                                  │
│    action: "confirm",                                              │
│    evidence: "code:src/auth/withdraw.dart:42"                      │
│  })                                                                │
│    PreToolUse → kg-require-validate-evidence.sh  ✓ has evidence   │
│    PostToolUse → kg-mark-tool-used.sh            ✓ (đã mark)     │
│                                                                    │
│  Claude gọi knowledge_promote({                                    │
│    id: "abc-123",                                                  │
│    reason: "Golden Evidence: [docs:README.md] [code:src/auth/...]  │
│             [tests:test/auth_test.dart] [task:KG-42]"              │
│  })                                                                │
│    PreToolUse → kg-require-golden-evidence.sh  ✓ all 4 sources    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─── Giả sử KG tool bị lỗi ────────────────────────────────────────┐
│                                                                    │
│  Claude gọi knowledge_query("payment")                             │
│  → Tool FAIL: "ECONNREFUSED 127.0.0.1:54321"                      │
│    PostToolUseFailure → kg-tool-failure.sh                         │
│    → inject: "[KG Recovery] Daemon not running. kg doctor → serve" │
│  Claude nói: "KG daemon is down. Run kg doctor to fix."            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─── Session dài, context bị compact ──────────────────────────────┐
│                                                                    │
│  Claude Code tự compact context window                             │
│  SessionStart(source=compact) fires                                │
│  → kg-session-start.sh                                             │
│  → inject: "Context compacted. Re-query KG to restore rules."     │
│  Claude re-queries knowledge_query("withdrawal")                   │
│  → Domain knowledge restored, work continues                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔══════════════════════════════════════════════════════════════════╗
║  SESSION END                                                      ║
║  Stop → kg-learning-capture-check.sh                              ║
║  → marker exists? Yes → silent. No → stderr reminder.             ║
║                                                                    ║
║  SessionEnd → kg-session-end-cleanup.sh                           ║
║  → rm markers: domains-checked, tool-used, session-reminder       ║
║  → 3 files deleted, ~3ms total                                    ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Blocked Flow: Khi Hook Chặn

```
Claude gọi knowledge_store({
  category: "fact",
  source: "observed: code pattern in withdraw.dart",
  domain: "authentication", ...
})

PreToolUse → kg-source-category-check.sh
  category="fact", source="observed: code pattern..."
  → fact + observed:* → BLOCKED

stderr → Claude:
  "BLOCKED: Category 'fact' cannot use source 'observed:...'.
   Facts must be user-confirmed or have no source.
   If inferred from code, store as 'insight' first."

Claude sửa:
  knowledge_store({
    category: "insight",
    source: "observed: code pattern in withdraw.dart",
    domain: "authentication", ...
  })

PreToolUse → kg-source-category-check.sh
  category="insight", source="observed:..." → ✓ ALLOWED

Claude sau đó interview user:
  "I noticed withdraw.dart has 3-step verification.
   Is this a business requirement?"

User confirms → Claude evolves:
  knowledge_evolve({
    id: "abc-123",
    new_metadata: { category: "fact", source: "user-confirmed: withdrawal flow" }
  })

PreToolUse → kg-source-category-check.sh
  category="fact", source="user-confirmed:..." → ✓ ALLOWED
```

Đây là interview protocol được enforce ở system level: insight → confirm → evolve to fact. Claude không thể shortcut bằng cách store thẳng fact từ code observation.

---

## Design Decisions: Tại sao chọn cách này

### Tại sao command hooks, không phải prompt hooks?

Claude Code hỗ trợ 4 loại hook handler:
- **command**: Bash script, deterministic, nhanh (~10-50ms)
- **http**: POST tới endpoint, nhanh, cần server
- **prompt**: Gửi input + prompt tới LLM (Haiku), chậm (~1-3s), judgment-based
- **agent**: Spawn subagent với tools, chậm (~5-30s), most powerful

Tất cả 11 hooks đều dùng command. Lý do:

1. **Policy checks là deterministic**: "Evidence field có empty không?" — không cần LLM judgment. Regex/grep đủ.
2. **Latency**: Command hook ~10ms. Prompt hook ~2s. Mỗi tool call có thể trigger 2-3 hooks. 3 prompt hooks = 6s delay per tool call.
3. **Predictability**: Command hook luôn cho cùng result với cùng input. Prompt hook có variance — LLM có thể quyết khác nhau cho input giống nhau.
4. **Cost**: Prompt hooks tốn API tokens. 5 prompt hooks × 20 tool calls/session = 100 LLM calls overhead.

**Khi nào nên dùng prompt hooks**: Khi logic cần judgment mà regex không làm được. Ví dụ tương lai: SubagentStop check "last_assistant_message có chứa domain knowledge không?" — cần LLM evaluate text.

### Tại sao SessionStart thay vì UserPromptSubmit?

| Factor | UserPromptSubmit | SessionStart |
|--------|-----------------|--------------|
| Fire frequency | Mỗi prompt | 1 lần per session start |
| Self-filtering | Phải dùng marker file | Không cần |
| Source awareness | Có `prompt` field | Có `source` field |
| Compact recovery | Không fire sau compact | Fire với `source=compact` |
| Unique capability | Biết user sắp hỏi gì | Biết tại sao session bắt đầu |

SessionStart thắng cho use case "inject KG reminder 1 lần". UserPromptSubmit giữ lại cho use case tương lai: prompt-aware KG retrieval (query KG dựa trên nội dung prompt).

### Tại sao backup chỉ 1 lần?

Setup-hooks chạy nhiều lần (ví dụ: update KG, re-install). Nếu backup mỗi lần:
- Lần 1: backup pre-KG state ✓
- Lần 2: backup state đã có KG hooks → overwrite pre-KG backup ✗

Backup 1 lần bảo tồn "point of no return" — luôn có thể restore về trạng thái trước khi KG hooks tồn tại.

### Tại sao SessionEnd timeout 1.5s là design constraint, không phải bug?

Claude Code thiết kế SessionEnd timeout ngắn vì:
- User đang đóng app/terminal — không muốn chờ
- Cleanup phải nhanh hoặc không làm gì
- Platform ưu tiên UX (exit nhanh) hơn cleanup completeness

Hook phản ứng bằng cách thiết kế minimalist: 3 lệnh rm -f, ~3ms. Không glob, không scan, không network. Constraint buộc code phải tốt.

---

## Deployment Architecture

```
Development (source of truth)
  flutter_tools/knowledge-graph/
    scripts/setup-hooks.sh          ← define hook scripts + settings merge logic
    scripts/remove-hooks.sh         ← reverse of setup-hooks
    src/cli.ts                      ← kg setup-hooks / kg remove-hooks commands
                                       + kg doctor hook count check

install.sh
  → copies scripts/ to ~/.knowledge-graph/scripts/
  → builds TypeScript, creates symlinks

CLI (per project)
  kg setup-hooks                    ← runs ~/.knowledge-graph/scripts/setup-hooks.sh
                                       from CWD of project
  → creates .claude/hooks/kg-*.sh   (11 files)
  → merges .claude/settings.local.json  (6 events)

  kg remove-hooks                   ← reverse
  → removes new hooks, restores originals
  → cleans settings, removes empty events

  kg doctor                         ← checks 11/11 hooks present
```

---

## Tổng hợp: 6 Claude Code Hook Events đang dùng

| Event | Hooks | Cơ chế chính | Khi nào fire |
|-------|:-----:|-------------|-------------|
| **PreToolUse** | 4 | Exit 2 blocking | Trước mỗi KG tool call |
| **PostToolUse** | 3 | Marker files + audit log (6 tools) | Sau mỗi KG tool thành công |
| **PostToolUseFailure** | 1 | JSON additionalContext | Sau mỗi KG tool thất bại |
| **SessionStart** | 1 | JSON additionalContext | Session bắt đầu (startup/compact/resume/clear) |
| **SessionEnd** | 1 | Direct file deletion | Session kết thúc |
| **Stop** | 1 | stderr reminder | Claude muốn dừng |

**Chưa dùng (16 events)**: SubagentStart, SubagentStop, TeammateIdle, TaskCompleted, InstructionsLoaded, ConfigChange, Notification, Elicitation, ElicitationResult, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PermissionRequest, PostToolUseFailure (cho non-KG tools), UserPromptSubmit (giữ slot cho phase 2).

---

## Phase 2 Roadmap (chưa implement)

| Hook | Event | Mục đích | Complexity |
|------|-------|----------|:----------:|
| `kg-prompt-retrieval.sh` | UserPromptSubmit | Prompt-aware KG query — detect domain keywords, inject relevant chunks | High |
| `kg-subagent-learning.sh` | SubagentStop | Nhắc subagent capture domain discoveries trước khi dừng | Medium |
| `kg-subagent-inject.sh` | SubagentStart | Inject generic KG discipline + recent parent domains cho subagent | Medium |
| `kg-post-compact-context.sh` | PostCompact | Snapshot recent domains/chunks trước compaction | Medium |
