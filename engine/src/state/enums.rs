use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    #[default]
    Long,
    Short,
}

impl Side {
    pub fn to_u8(self) -> u8 {
        match self {
            Side::Long => 0,
            Side::Short => 1,
        }
    }
    pub fn opposite(self) -> Self {
        match self {
            Side::Long => Side::Short,
            Side::Short => Side::Long,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    #[default]
    Limit,
    Market,
    PostOnly,
}

impl OrderType {
    pub fn to_u8(self) -> u8 {
        match self {
            OrderType::Limit => 0,
            OrderType::Market => 1,
            OrderType::PostOnly => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketStatus {
    #[default]
    Active,
    ReduceOnly,
    Paused,
}
