export interface TelegramAlert {
  transitionId: string;
  productName: string;
  storeId: string;
  previousPrice: number;
  currentPrice: number;
  targetPrice: number | null;
  priceDrop: true;
  targetCrossed: boolean;
  observedAt: string;
  productUrl: string;
}

export interface AlertDeliveryResult {
  state: "sent" | "failed" | "unknown" | "unavailable";
  claimed: boolean;
}

export interface TelegramAlertService {
  deliver(alert: TelegramAlert): Promise<AlertDeliveryResult>;
}
