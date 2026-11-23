-- CreateTable
CREATE TABLE "Season" (
    "year" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "Season_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kgMid" TEXT,
    "wikiArticle" TEXT,
    "isAlive" BOOLEAN,
    "diedAt" TIMESTAMP(3),
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "homeCountry" TEXT,
    "notes" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alias" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "foldedKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YisResult" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "sourceUrl" TEXT,

    CONSTRAINT "YisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawFetch" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "RawFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendPoint" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "geo" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "TrendPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPoint" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "WikiPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "question" TEXT NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOutcome" (
    "id" SERIAL NOT NULL,
    "marketId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MarketOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" SERIAL NOT NULL,
    "outcomeId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "probability" DOUBLE PRECISION,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSnapshot" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "values" JSONB NOT NULL,

    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "output" JSONB NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backtest" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "Backtest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_name_key" ON "Person"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_kgMid_key" ON "Person"("kgMid");

-- CreateIndex
CREATE INDEX "Alias_foldedKey_idx" ON "Alias"("foldedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Alias_personId_term_key" ON "Alias"("personId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "YisResult_year_scope_list_rank_key" ON "YisResult"("year", "scope", "list", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "YisResult_year_scope_list_personId_key" ON "YisResult"("year", "scope", "list", "personId");

-- CreateIndex
CREATE INDEX "TrendPoint_personId_observedAt_idx" ON "TrendPoint"("personId", "observedAt");

-- CreateIndex
CREATE INDEX "WikiPoint_personId_observedAt_idx" ON "WikiPoint"("personId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Market_source_externalId_key" ON "Market"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOutcome_marketId_name_key" ON "MarketOutcome"("marketId", "name");

-- CreateIndex
CREATE INDEX "MarketSnapshot_outcomeId_observedAt_idx" ON "MarketSnapshot"("outcomeId", "observedAt");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_year_personId_observedAt_idx" ON "FeatureSnapshot"("year", "personId", "observedAt");

-- CreateIndex
CREATE INDEX "Prediction_year_personId_idx" ON "Prediction"("year", "personId");
-- AddForeignKey
ALTER TABLE "Alias" ADD CONSTRAINT "Alias_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YisResult" ADD CONSTRAINT "YisResult_year_fkey" FOREIGN KEY ("year") REFERENCES "Season"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YisResult" ADD CONSTRAINT "YisResult_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOutcome" ADD CONSTRAINT "MarketOutcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "MarketOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
