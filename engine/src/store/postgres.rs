use anyhow::Result;
use sqlx::PgPool;

use crate::matching::place_order::Fill;
use crate::state::position::Position;

pub struct PgStore {
    pool: PgPool,
}

impl PgStore {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = PgPool::connect(url).await?;
        Ok(Self { pool })
    }

    pub async fn insert_fills(&self, market: &str, fills: &[Fill]) -> Result<()> {
        for f in fills {
            sqlx::query!(
                r#"
                INSERT INTO fills (market, maker, price, size, maker_seq, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                "#,
                market,
                f.maker,
                f.price as i64,
                f.size as i64,
                f.maker_seq as i64,
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn upsert_position(&self, pos: &Position) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO positions (id, market, trader, side, size, entry_price, collateral,
                                   last_funding_rate, realized_pnl, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (market, trader) DO UPDATE SET
                side = EXCLUDED.side,
                size = EXCLUDED.size,
                entry_price = EXCLUDED.entry_price,
                collateral = EXCLUDED.collateral,
                last_funding_rate = EXCLUDED.last_funding_rate,
                realized_pnl = EXCLUDED.realized_pnl,
                updated_at = NOW()
            "#,
            pos.id,
            pos.market,
            pos.trader,
            format!("{:?}", pos.side),
            pos.size as i64,
            pos.entry_price as i64,
            pos.collateral as i64,
            pos.last_funding_rate,
            pos.realized_pnl,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
