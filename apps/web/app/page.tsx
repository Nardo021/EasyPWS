"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  easypwsApi,
  getStoredToken,
  setStoredToken,
  type PricePoint,
  type WatchlistItem,
} from "../lib/api";
import { PriceChart } from "../components/PriceChart";

export default function HomePage() {
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  const selectedItem = useMemo(
    () => items.find((i) => i.listingId === selected) ?? null,
    [items, selected],
  );

  function refreshList() {
    startTransition(async () => {
      setError(null);
      try {
        const data = await easypwsApi.listWatchlist();
        setItems(data.items);
        if (!selected && data.items[0]) {
          setSelected(data.items[0].listingId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  useEffect(() => {
    if (token) {
      refreshList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      <p className="tagline">监控 Coles 价格、半价与历史最低 —— 独立于 Home Assistant。</p>

      <section className="row">
        <input
          placeholder="API Bearer Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setStoredToken(token.trim());
            refreshList();
          }}
        >
          保存 Token
        </button>
      </section>

      <section className="panel">
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
        {items.length === 0 ? (
          <p className="meta">还没有监控商品。先保存 Token，再粘贴 Coles URL。</p>
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
                  {item.retailer} · {item.promotionType}
                  {item.discountPercentage !== undefined
                    ? ` · -${item.discountPercentage}%`
                    : ""}
                  <br />
                  历史最低 {item.historicalLow ?? "—"} · 目标{" "}
                  {item.targetPrice ?? "—"} ·{" "}
                  {item.monitoringStatus === "active" ? "监控中" : "已暂停"}
                  <br />
                  <a href={item.productUrl} target="_blank" rel="noreferrer">
                    打开商品页
                  </a>
                </div>
              </div>
              <div>
                <div className="price">
                  {item.currentPrice !== undefined ? `$${item.currentPrice.toFixed(2)}` : "—"}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      startTransition(async () => {
                        await easypwsApi.refresh(item.watchlistItemId);
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
                          item.monitoringStatus === "active" ? "paused" : "active",
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
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
            {selectedItem.productName}
          </h2>
          <p className="meta">价格走势（append-only observations）</p>
          <PriceChart points={points} />
        </section>
      ) : null}
    </main>
  );
}
