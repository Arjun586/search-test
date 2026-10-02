# Strategy 1: PostgreSQL ILIKE with Trigrams (`pg_trgm`)

## 💡 What is it?
Imagine looking for a word inside a book by reading through every single line from start to finish. That is standard SQL `LIKE '%query%'` — simple, but slow for large data.

**Trigram search (`pg_trgm`)** is PostgreSQL’s way of making substring searches fast by breaking text into tiny 3-letter slices.

---

## ⚙️ How does it work?

### 1. Breaking text into Trigrams (3-letter chunks)
PostgreSQL takes your text and cuts it into 3-character slices:
- The word `"apple"` becomes:
  - `"  a"`, `" ap"`, `"app"`, `"ppl"`, `"ple"`, `"le "`

### 2. Fast Index Lookup (GIN)
PostgreSQL creates an index (like a lookup dictionary) of all these 3-letter slices.
- When you search for `"ppl"`, Postgres looks up `"ppl"` in the index.
- It immediately knows which rows contain `"ppl"` without scanning the whole table!

```
Search query: "ppl"
       │
       ▼
[ Trigram Index ] ──► Found in Document #1 ("apple"), Document #14 ("application")
       │
       ▼
Returns matching rows instantly
```

---

## 🛠️ How this project uses it

1. **Extension & Index (`setup.ts`):**
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;

   CREATE INDEX documents_searchable_text_trgm_idx
     ON documents USING GIN (searchable_text gin_trgm_ops);
   ```

2. **Search Query (`search.ts`):**
   ```sql
   WITH matched AS (
     SELECT id, document, count(*) OVER () AS total_count
     FROM documents
     WHERE searchable_text ILIKE '%' || $1 || '%'
   )
   SELECT id, document, total_count
   FROM matched
   LIMIT 5;
   ```

   > ⚠️ **Why `count(*) OVER ()` matters:**  
   > Real-world search UIs require both paginated results (e.g. top 5) and the total count of matches across the dataset (e.g. "Showing 1–5 of 12,511 results"). The window function `count(*) OVER ()` computes this total count across the full corpus. Because our benchmark tested the common word `"database"` (matching 12,511 rows), Postgres had to evaluate every match across the 100k documents. If you omit `count(*) OVER ()`, Postgres can stop scanning after finding the first 5 rows (early exit), making ILIKE appear artificially faster than in real pagination workloads.

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Finds partial words and substrings (e.g., `phone` finds `iPhone`) | No relevance ranking (a match is just yes/no) |
| Case-insensitive out of the box | Performance depends heavily on term frequency (common words matching many rows require scanning large trigram lists) |
| Works inside your existing PostgreSQL database | Trigram indexes can take up significant storage space |

---

## 🎯 When to use it?
- You need to search **partial words**, **usernames**, **emails**, or **SKUs** where character-level substring matching is necessary.
- You have high selectivity (searching specific terms matching few documents). Note: on a common word like `"database"` matching 12,511 of 100,000 documents with full corpus counting, ILIKE averaged ~558 ms.
- You want simple substring matching without installing or managing an external search engine.
- You don't need relevance ranking (sorting by "best match").

> **Key Takeaway:** Perfect for "starts with", "contains", or partial word matching directly in PostgreSQL, but avoid using it for frequent common-word text search across large tables.
