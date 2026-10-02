# Strategy 2: PostgreSQL Full-Text Search (FTS)

## 💡 What is it?
Unlike trigrams that look at raw letters, **PostgreSQL Full-Text Search (FTS)** understands **words** and **natural language**.

It is PostgreSQL's built-in search engine for documents, articles, descriptions, and sentences.

---

## ⚙️ How does it work?

Instead of looking for character fragments, FTS processes your text in three smart steps:

### 1. Stemming (Finding the root word)
Words with the same meaning are converted to their base form:
- `"running"`, `"runs"`, `"ran"` ➔ converted to `"run"`
- If a user searches for `"run"`, documents with `"running"` will still match!

### 2. Removing Stop Words
Common filler words that add no search value (like `"the"`, `"is"`, `"at"`, `"and"`) are ignored so the index stays small and fast.

### 3. Relevance Ranking (`ts_rank`)
PostgreSQL scores each match based on how relevant it is (e.g., how often the word appears and where it is located).

```
"The quick runner is running fast"
             │
             ▼ (Clean & Stem)
     ['quick', 'run', 'fast']
             │
             ▼
   Stored as a TSVECTOR
```

---

## 🛠️ How this project uses it

1. **Table Column & Index (`setup.ts`):**
   ```sql
   -- Automatically converts searchable_text into searchable words
   search_vector TSVECTOR GENERATED ALWAYS AS (
     to_tsvector('english', coalesce(searchable_text, ''))
   ) STORED;

   -- Fast GIN index over the words
   CREATE INDEX documents_search_vector_idx
     ON documents USING GIN (search_vector);
   ```

2. **Search Query (`search.ts`):**
   ```sql
   SELECT id, document, ts_rank(search_vector, query) AS score
   FROM documents, websearch_to_tsquery('english', $1) AS query
   WHERE search_vector @@ query
   ORDER BY score DESC
   LIMIT 5;
   ```

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Understands language grammar and word stems | Cannot match partial words (searching `cat` won't find `caterpillar`) |
| Provides relevance scoring (`ts_rank`) to order best results | Language-dependent (needs language dictionary like 'english') |
| Zero extra infrastructure (already inside PostgreSQL) | Slower than dedicated search engines (like Elasticsearch) at massive scale |

---

## 🎯 When to use it?
- You want **Google-like text search** (descriptions, articles, comments) with results ranked by relevance.
- You want to keep your stack simple without hosting and managing an external search engine.
- Your dataset fits comfortably inside a single PostgreSQL database.

> **Key Takeaway:** The best choice for natural language search and relevance ranking without adding new servers.
