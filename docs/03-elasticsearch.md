# Strategy 3: Elasticsearch

## 💡 What is it?
**Elasticsearch** is a dedicated search engine built entirely from the ground up for high-speed search across massive amounts of data.

Unlike PostgreSQL (which is primarily a relational database with search features), Elasticsearch is a specialized distributed search and analytics engine powered by Apache Lucene.

---

## ⚙️ How does it work?

### The Inverted Index (The "Book Index" Concept)
Think of the index at the back of a textbook:
- Instead of reading the whole book to find where a word appears, you look up the word in the back index and see exact page numbers.
- Elasticsearch does the same thing for every word across all your documents:

```
Term        Document IDs
-------------------------
"phone"  ──► [ Doc 1, Doc 4, Doc 18 ]
"camera" ──► [ Doc 2, Doc 4 ]
"smart"  ──► [ Doc 1, Doc 2, Doc 99 ]
```

When you search for `"phone"`, Elasticsearch immediately looks up the list `[1, 4, 18]` in memory.

### Advanced Relevance (BM25)
Elasticsearch automatically ranks results using the **BM25 algorithm**, which factors in:
- How often the word appears in the document.
- How rare the word is across the whole dataset (rare words score higher).
- Document length.

---

## 🛠️ How this project uses it

1. **Index Mapping (`setup.ts`):**
   ```json
   {
     "properties": {
       "id": { "type": "keyword" },
       "document": { "type": "object" },
       "searchable_text": { "type": "text", "analyzer": "standard" }
     }
   }
   ```

2. **Search Query (`search.ts`):**
   ```typescript
   await elasticsearch.search({
     index: 'search_benchmark_documents',
     size: 5,
     track_total_hits: true,
     query: {
       multi_match: {
         query: userQuery,
         fields: ['searchable_text'],
         operator: 'and',
       },
     },
   });
   ```

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Blazing fast search speeds across massive datasets | Extra operational complexity (separate service to manage and monitor) |
| Distributed by design (scales horizontally across many nodes) | Data must be synchronized between PostgreSQL and Elasticsearch |
| Industry-standard relevance scoring (BM25) and configurable analyzers | Consumes more RAM and heap memory |

---

## 🎯 When to use it?
- You have **large datasets** or high concurrent search traffic (as a rough rule of thumb, multi-million records or search volume that competes for resources with transactional DB workloads).
- You need **single-digit millisecond latency** for heavy search workloads (e.g. e-commerce search, log aggregation; our 100k benchmark recorded 5.60 ms min and 8.09 ms average).
- Your primary database (PostgreSQL) is getting overloaded by search queries or complex aggregations.

> **Key Takeaway:** The gold standard when you outgrow your primary database and need dedicated, massive-scale search power.
