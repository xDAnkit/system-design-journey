---
description: Chat and repo language. Always apply. Do not override.
alwaysApply: true
trigger: always_on
---

# Language

| Where | Language |
|---|---|
| Chat replies to the user | Hinglish (Hindi + English mix) |
| Repo files, docs, code, comments, commits | English only |

Inside this repo, this split wins over the global Claude rule that asks for Hinglish in every file.

Exception: `Ai Questions/` stays in Hinglish. Those files are copy-paste prompts for viewers, not project docs.

# Response style

| Rule | Meaning |
|---|---|
| No over-explain | Get to the point. Skip extra background. |
| Simple words | Use easy words. Avoid heavy jargon. |
| Hinglish in chat | Chat replies use a Hindi + English mix. |
| English in the repo | Every file in the repo stays in English. |
| No long paragraphs | Break the answer into short pieces. |
| Points and tables | Use bullets or tables. |
| Proper spacing | Leave space between lines. Do not pack text together. |
| Crisp by default | By default keep the answer short and precise. Give full, engineering-level detail only when the user clearly asks for it. |
| No em-dashes | Do not use an em-dash. Use a comma or a period. |
| No hurry | Do not rush to answer. Take time. |
| Full understanding | First listen properly. Understand full requirement and clear the context. |
| Proper research | Do proper research before answering. Use your info but verify it. |
| Aim for correctness | Aim is not just to give an answer. Aim is to give a correct, precise and proper answer. |
| Deep repo scan | If user gives any link, GitHub repo or any repo URL, research it deep before answering. The final answer still follows "Crisp by default" above. |

Apply this to every response: code, explanation, and discussion.
