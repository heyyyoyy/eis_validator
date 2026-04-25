use rig::Embed;
use rig_sqlite::{Column, ColumnValue, SqliteVectorStoreTable};
use serde::{Deserialize, Serialize};

#[derive(Embed, Clone, Debug, Serialize, Deserialize)]
pub struct EisDocuments {
    pub id: String,
    pub file_name: String,
    /// Page number as text (rig-sqlite reads all row columns as `String`).
    pub page: String,
    /// Chunk index as text (same constraint as `page`).
    pub chunk_index: String,
    #[embed]
    pub content: String,
}

impl SqliteVectorStoreTable for EisDocuments {
    fn name() -> &'static str {
        "eis_documents"
    }

    fn schema() -> Vec<Column> {
        vec![
            Column::new("id", "TEXT PRIMARY KEY"),
            Column::new("file_name", "TEXT").indexed(),
            Column::new("page", "TEXT"),
            Column::new("chunk_index", "TEXT"),
            Column::new("content", "TEXT"),
        ]
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    fn column_values(&self) -> Vec<(&'static str, Box<dyn ColumnValue>)> {
        vec![
            ("id", Box::new(self.id.clone())),
            ("file_name", Box::new(self.file_name.clone())),
            ("page", Box::new(self.page.clone())),
            ("chunk_index", Box::new(self.chunk_index.clone())),
            ("content", Box::new(self.content.clone())),
        ]
    }
}
