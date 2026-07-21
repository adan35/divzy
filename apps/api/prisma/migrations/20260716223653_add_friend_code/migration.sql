-- CreateTable
CREATE TABLE "FriendCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FriendCode_userId_key" ON "FriendCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendCode_code_key" ON "FriendCode"("code");
