-- CreateTable
CREATE TABLE "StaleBalanceReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lastRemindedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaleBalanceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaleBalanceReminder_userId_idx" ON "StaleBalanceReminder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaleBalanceReminder_userId_counterpartyId_currency_key" ON "StaleBalanceReminder"("userId", "counterpartyId", "currency");
