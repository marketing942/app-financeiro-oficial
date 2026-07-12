// Regras de rate limiting da Nylo (AI_NYLO §5) — função pura, testável.
// Contagens vêm de ai_usage_logs via nylo_rate_status().

export const NYLO_USER_DAILY_LIMIT = Number(
  process.env.NYLO_DAILY_MESSAGE_LIMIT ?? 100
);
export const NYLO_CONVERSATION_MESSAGE_LIMIT = 200;

export type RateStatus = {
  userMessagesToday: number;
  workspaceMessagesMonth: number;
  monthlyLimit: number | null; // workspace_settings.nylo_monthly_message_limit
};

export type RateDecision =
  { allowed: true } | { allowed: false; reason: string };

export function checkRateLimit(status: RateStatus): RateDecision {
  if (status.userMessagesToday >= NYLO_USER_DAILY_LIMIT) {
    return {
      allowed: false,
      reason:
        "Você atingiu o limite diário de mensagens da Nylo. Tente novamente amanhã.",
    };
  }
  if (
    status.monthlyLimit !== null &&
    status.workspaceMessagesMonth >= status.monthlyLimit
  ) {
    return {
      allowed: false,
      reason: "O limite mensal de mensagens da Nylo deste espaço foi atingido.",
    };
  }
  return { allowed: true };
}
