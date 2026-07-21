-- CreateTable
CREATE TABLE "ManualExchangeRate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualExchangeRate_userId_idx" ON "ManualExchangeRate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualExchangeRate_userId_fromCurrency_toCurrency_key" ON "ManualExchangeRate"("userId", "fromCurrency", "toCurrency");

-- AddForeignKey
ALTER TABLE "ManualExchangeRate" ADD CONSTRAINT "ManualExchangeRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
