use rig::Embed;
use serde::{Deserialize, Serialize};

#[derive(Embed, Clone, Debug, Serialize, Deserialize)]
pub struct EisDocuments {
    pub id: String,
    pub file_name: String,
    /// Heading / section name this chunk belongs to.
    pub page: String,
    /// Position of this chunk within its section.
    pub chunk_index: String,
    #[embed]
    pub content: String,
}
