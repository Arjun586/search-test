# Strategy 2: PostgreSQL Full-Text Search (FTS)

## 💡 What is it?
Unlike trigrams that look at raw letters, **PostgreSQL Full-Text Search (FTS)** understands **words** and **natural language**.

It is PostgreSQL's built-in search engine for documents, articles, descriptions, and sentences.

---

## ⚙️ How does it work?

Instead of looking for character fragments, FTS processes your text in three smart steps:

### 1. Stemming (Finding the root word)
Words with common grammatical endings are reduced to their base lexeme using an algorithmic stemmer (PostgreSQL's default English dictionary uses the Snowball stemmer):
- `"running"` and `"runs"` ➔ converted to `"run"`
- *Note on irregular forms:* Algorithmic stemmers strip regular suffixes (like `-ing`, `-s`, `-ed`), but irregular verb forms like `"ran"` remain as `'ran'` (not normalized to `"run"` unless custom dictionary mapping is added).
- If a user searches for `"run"`, documents containing `"running"` or `"runs"` will match!

### 2. Removing Stop Words
Common filler words that add no search value (like `"the"`, `"is"`, `"at"`, `"and"`) are ignored so the index stays small and fast.

### 3. Relevance Ranking (`ts_rank`)
PostgreSQL scores each match based on how relevant it is (e.g., how often the word appears and where it is located).

```
Input: "The quick runner is running fast"
               │
               ▼ (Stop words removed: "The" [1], "is" [4])
               ▼ (Stemming: "running" [5] -> "run")
               │
               ▼
Stored as TSVECTOR: 'fast':6 'quick':2 'run':5 'runner':3
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
   WITH parsed_query AS (
     SELECT websearch_to_tsquery('english', $1) AS value
   ),
   matched AS (
     SELECT d.id, d.document, ts_rank(d.search_vector, q.value) AS score, count(*) OVER () AS total_count
     FROM documents d
     CROSS JOIN parsed_query q
     WHERE d.search_vector @@ q.value
   )
   SELECT id, document, score, total_count
   FROM matched
   ORDER BY score DESC
   LIMIT 5;
   ```

   > ⚠️ **Why `count(*) OVER ()` matters:**  
   > Like in ILIKE, the window function `count(*) OVER ()` calculates the total matching documents across the entire corpus for pagination. In our benchmark, PostgreSQL scored matches using `ts_rank` and computed the total 12,511 matches across all 100,000 rows. Without `count(*) OVER ()`, queries that only need the top 5 could execute faster, but pagination would require a separate count query.

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Understands language grammar and word stems | Cannot match partial words (searching `cat` won't find `caterpillar`) |
| Provides relevance scoring (`ts_rank`) to order best results | Language-dependent (needs language dictionary like 'english') |
| Zero extra infrastructure (already inside PostgreSQL) | Slower than dedicated search engines (like Elasticsearch) at large scale |

---

## 🎯 When to use it?
- You want **natural language search** (descriptions, articles, comments) with results ranked by relevance.
- You want to keep your stack simple without hosting and managing an external search engine.
- Your dataset fits comfortably inside a single PostgreSQL database (as a rough rule of thumb, up to hundreds of thousands or low millions of rows where search traffic does not overwhelm transactional workloads).

> **Key Takeaway:** The best choice for natural language search and relevance ranking without adding new servers.
