"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  clearStoredToken,
  easypwsApi,
  getStoredToken,
  maskToken,
  setStoredToken,
  type PricePoint,
  type SearchResult,
  type WatchlistItem,
} from "../lib/api";
import { PriceChart } from "../components/PriceChart";

export default function HomePage() {
  const [tokenInput, setTokenInput] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const selectedItem = useMemo(
    () => items.find((i) => i.listingId === selected) ?? null,
    [items, selected],
  );

  function applyItems(nextItems: WatchlistItem[]) {
    setItems(nextItems);
    setTargetDrafts((prev) => {
      const next = { ...prev };
      for (const item of nextItems) {
        if (next[item.watchlistItemId] === undefined) {
          next[item.watchlistItemId] =
            item.targetPrice !== undefined ? String(item.targetPrice) : "";
        }
      }
      return next;
    });
    if (!selected && nextItems[0]) {
      setSelected(nextItems[0].listingId);
    }
  }

  function refreshList() {
    startTransition(async () => {
      setError(null);
      try {
        const data = await easypwsApi.listWatchlist();
        applyItems(data.items);
        if (!localMode) {
          const me = await easypwsApi.me();
          setInfo(`已登录 ${me.email}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  useEffect(() => {
    const existing = getStoredToken();
    setSavedToken(existing);
    setTokenInput(existing);
    let cancelled = false;
    void (async () => {
      try {
        const me = await easypwsApi.me();
        if (cancelled) {
          return;
        }
        if (me.mode === "local") {
          setLocalMode(true);
          setBanner(
            [me.storeName, me.storeId ? `门店 ${me.storeId}` : "", me.sourceLabel, me.priceNote]
              .filter(Boolean)
              .join(" · "),
          );
          const data = await easypwsApi.listWatchlist();
          if (!cancelled) {
            applyItems(data.items);
          }
          return;
        }
        if (!existing) {
          return;
        }
        const data = await easypwsApi.listWatchlist();
        if (!cancelled) {
          applyItems(data.items);
          setInfo(`已登录 ${me.email}`);
        }
      } catch (err) {
        if (cancelled || !existing) {
          return;
        }
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      return;
    }
    startTransition(async () => {
      try {
        const hist = await easypwsApi.history(selected);
        setPoints(hist.points);
      } catch {
        setPoints([]);
      }
    });
  }, [selected]);

  return (
    <main>
      <h1 className="brand">EasyPWS</h1>
      <p className="tagline">
        监控 Coles 价格、半价与历史最低 —— 独立于 Home Assistant。
      </p>

      {banner ? <p className="meta">{banner}</p> : null}
      {pending ? <p className="meta">正在处理…</p> : null}
      {localMode ? null : (
      <>
      <section className="row">
        <input
          type={showToken ? "text" : "password"}
          placeholder="API Bearer Token（BOOTSTRAP_TOKEN）"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setShowToken((v) => !v)}
        >
          {showToken ? "隐藏" : "显示"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const next = tokenInput.trim();
            setStoredToken(next);
            setSavedToken(next);
            setInfo(next ? `已保存 ${maskToken(next)}` : "已清除 Token");
            if (next) {
              refreshList();
            } else {
              setItems([]);
            }
          }}
        >
          保存
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            clearStoredToken();
            setTokenInput("");
            setSavedToken("");
            setItems([]);
            setInfo("已清除本地 Token");
          }}
        >
          清除
        </button>
      </section>
      {savedToken ? (
        <p className="meta">当前 Token：{maskToken(savedToken)}</p>
      ) : (
        <p className="meta">
          首次部署：`journalctl -u easypws -n 100 | grep BOOTSTRAP_TOKEN`
        </p>
      )}
      </>
      )}
      {info ? <p className="meta">{info}</p> : null}

      <section className="panel">
        <h2 className="section-title">搜索 Coles</h2>
        <div className="row">
          <input
            placeholder="关键词（若被风控拦截请改用 URL 导入）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            disabled={pending || query.trim().length < 2}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                try {
                  const data = await easypwsApi.search(query.trim());
                  setSearched(true);
                  setSearchResults(data.items);
                } catch (err) {
                  setSearchResults([]);
                  setError(err instanceof Error ? err.message : String(err));
                }
              });
            }}
          >
            搜索
          </button>
        </div>
        {searchResults.length > 0 ? (
          <div className="search-list">
            {searchResults.map((r) => (
              <div key={r.retailerProductId} className="search-item">
                <div>
                  <strong>
                    {[r.brand, r.name, r.size].filter(Boolean).join(" ")}
                  </strong>
                  <div className="meta">
                    {r.currentPrice !== undefined ? `$${r.currentPrice}` : "—"}{" "}
                    ·{" "}
                    <a href={r.productUrl} target="_blank" rel="noreferrer">
                      商品页
                    </a>
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setUrl(r.productUrl);
                    startTransition(async () => {
                      setError(null);
                      try {
                        await easypwsApi.importProduct(r.productUrl);
                        refreshList();
                        setInfo(`已加入监控：${r.name}`);
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : String(err),
                        );
                      }
                    });
                  }}
                >
                  监控
                </button>
              </div>
            ))}
          </div>
        ) : searched ? (
          <p className="meta">没有匹配的商品。</p>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="section-title">URL 导入</h2>
        <div className="row">
          <input
            placeholder="粘贴 Coles 商品 URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            placeholder="目标价（可选）"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <button
            type="button"
            disabled={pending || !url.trim()}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                try {
                  const targetPrice = target ? Number(target) : undefined;
                  await easypwsApi.importProduct(
                    url.trim(),
                    Number.isFinite(targetPrice) ? targetPrice : undefined,
                  );
                  setUrl("");
                  refreshList();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              });
            }}
          >
            加入监控
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="panel">
        <h2 className="section-title">Watchlist</h2>
        {items.length === 0 ? (
          <p className="meta">
            {localMode
              ? "还没有监控商品。搜索，或粘贴 Coles 商品链接。"
              : "还没有监控商品。先保存 Token，再粘贴 Coles URL。"}
          </p>
        ) : (
          items.map((item) => (
            <article key={item.watchlistItemId} className="item">
              <div>
                <h3>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: 0, border: 0 }}
                    onClick={() => setSelected(item.listingId)}
                  >
                    {item.productName}
                  </button>
                </h3>
                <div className="meta">
                  {item.storeName ? `${item.storeName} · ` : ""}
                  {item.retailer} · {item.promotionType}
                  {item.availabilityLabel ? ` · ${item.availabilityLabel}` : ""}
                  {item.discountPercentage !== undefined
                    ? ` · -${item.discountPercentage}%`
                    : ""}
                  <br />
                  历史最低 {item.historicalLow ?? "—"} ·{" "}
                  {item.monitoringStatus === "active" ? "监控中" : "已暂停"}
                  <br />
                  {item.sourceLabel ? `${item.sourceLabel} · ` : ""}
                  {item.lastCheckedAt
                    ? `上次获取 ${new Date(item.lastCheckedAt).toLocaleString("zh-CN")}`
                    : "尚未获取"}
                  <br />
                  {item.alerts?.[0] ? (
                    <>
                      {item.alerts[0]}
                      <br />
                    </>
                  ) : null}
                  {item.priceNote ? (
                    <>
                      {item.priceNote}
                      <br />
                    </>
                  ) : null}
                  <a href={item.productUrl} target="_blank" rel="noreferrer">
                    打开商品页
                  </a>
                </div>
                <div className="row" style={{ marginTop: "0.6rem" }}>
                  <input
                    placeholder="目标价"
                    value={targetDrafts[item.watchlistItemId] ?? ""}
                    onChange={(e) =>
                      setTargetDrafts((prev) => ({
                        ...prev,
                        [item.watchlistItemId]: e.target.value,
                      }))
                    }
                    style={{ maxWidth: 120 }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const value = Number(targetDrafts[item.watchlistItemId]);
                      if (!Number.isFinite(value)) {
                        setError("目标价必须是数字");
                        return;
                      }
                      startTransition(async () => {
                        setError(null);
                        await easypwsApi.setTarget(item.watchlistItemId, value);
                        refreshList();
                      });
                    }}
                  >
                    设目标价
                  </button>
                </div>
              </div>
              <div>
                <div className="price">
                  {item.currentPrice !== undefined
                    ? `$${item.currentPrice.toFixed(2)}`
                    : "—"}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        try {
                          await easypwsApi.refresh(item.watchlistItemId);
                          const data = await easypwsApi.listWatchlist();
                          applyItems(data.items);
                          setInfo(localMode ? "已刷新报告价" : "已排队刷新");
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : String(err),
                          );
                        }
                      })
                    }
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      startTransition(async () => {
                        await easypwsApi.setStatus(
                          item.watchlistItemId,
                          item.monitoringStatus === "active"
                            ? "paused"
                            : "active",
                        );
                        refreshList();
                      })
                    }
                  >
                    {item.monitoringStatus === "active" ? "暂停" : "恢复"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      startTransition(async () => {
                        await easypwsApi.remove(item.watchlistItemId);
                        refreshList();
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {selectedItem ? (
        <section className="panel">
          <h2 className="section-title">{selectedItem.productName}</h2>
          <p className="meta">价格走势（append-only observations）</p>
          <PriceChart points={points} />
        </section>
      ) : null}
    </main>
  );
}
