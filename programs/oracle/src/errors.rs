use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("caller is not the authorized keeper for this feed")]
    UnauthorizedKeeper,

    #[msg("price update rejected: deviation exceeds 10% from previous price")]
    PriceDeviationTooLarge,

    #[msg("price must be greater than zero")]
    ZeroPrice,
}
