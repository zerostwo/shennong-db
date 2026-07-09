`%||%` <- function(x, y) {
  if (is.null(x)) y else x
}

new_shennong_lazy <- function(
  dataset,
  version = "latest",
  api_url = sn_get_api_url(),
  token = sn_get_api_token(),
  assay = "rna",
  data_model = NULL,
  layer = NULL,
  measure = "expression",
  observations = list(),
  fields = character(),
  features = character(),
  options = list(limit = 1000)
) {
  structure(
    list(
      dataset = dataset,
      version = version,
      api_url = sub("/+$", "", api_url),
      token = token,
      assay = assay,
      data_model = data_model,
      layer = layer,
      measure = measure,
      observations = observations,
      fields = fields,
      features = features,
      options = options
    ),
    class = "shennong_lazy"
  )
}

is_shennong_lazy <- function(x) {
  inherits(x, "shennong_lazy")
}

check_shennong_lazy <- function(x) {
  if (!is_shennong_lazy(x)) {
    rlang::abort("Expected a ShennongData lazy dataset returned by `sn_load_data()`.")
  }
  invisible(x)
}

#' Create a lazy Shennong dataset handle
#'
#' `sn_load_data()` does not download matrix or observation data. It only stores
#' the dataset id, server URL, and query defaults. Use `filter()` and `select()`
#' to refine the handle, then call `sn_collect()`, `sn_fetch_genes()`, or a plot
#' helper to request a bounded page from `/v1/query`.
#'
#' @param dataset Dataset id in the Shennong catalog.
#' @param version Dataset version. `"latest"` resolves on the server.
#' @param api_url Shennong Data Server base URL.
#' @param token Optional bearer token.
#' @param assay Assay name, usually `"rna"`.
#' @param data_model Optional semantic data model, for example `"bulk"` or
#'   `"single_cell"`. When `NULL`, the server infers the model from the catalog.
#' @param layer Optional layer name such as `"log2_tpm"` or `"lognorm"`.
#' @param measure Query measure, usually `"expression"`.
#' @param limit Default page size for later collection.
#' @return A lazy Shennong dataset object.
#' @export
sn_load_data <- function(
  dataset,
  version = "latest",
  api_url = sn_get_api_url(),
  token = sn_get_api_token(),
  assay = "rna",
  data_model = NULL,
  layer = NULL,
  measure = "expression",
  limit = 1000
) {
  if (!is.character(dataset) || length(dataset) != 1L || !nzchar(dataset)) {
    rlang::abort("`dataset` must be a single non-empty string.")
  }
  if (!is.numeric(limit) || length(limit) != 1L || is.na(limit) || limit < 1) {
    rlang::abort("`limit` must be a positive number.")
  }
  new_shennong_lazy(
    dataset = dataset,
    version = version,
    api_url = api_url,
    token = token,
    assay = assay,
    data_model = data_model,
    layer = layer,
    measure = measure,
    options = list(limit = as.integer(limit))
  )
}

#' @export
print.shennong_lazy <- function(x, ...) {
  cat("# ShennongData lazy dataset\n")
  cat("dataset: ", x$dataset, "\n", sep = "")
  cat("version: ", x$version %||% "latest", "\n", sep = "")
  cat("api_url: ", x$api_url, "\n", sep = "")
  cat("assay:   ", x$assay, "\n", sep = "")
  if (!is.null(x$data_model)) {
    cat("model:   ", x$data_model, "\n", sep = "")
  }
  if (length(x$observations)) {
    cat("filters:\n")
    for (name in names(x$observations)) {
      cat("  - ", name, ": ", paste(x$observations[[name]], collapse = ", "), "\n", sep = "")
    }
  }
  cat("\nNo data has been downloaded. Use `sn_collect()` to fetch a bounded page.\n")
  invisible(x)
}

#' Build the semantic QuerySpec for a lazy handle
#'
#' This helper is useful for inspection and tests. It does not perform an HTTP
#' request.
#'
#' @param x A lazy Shennong dataset.
#' @param features Feature names such as genes.
#' @param fields Observation or metadata fields to include.
#' @param limit Page size.
#' @param cursor Optional server cursor for the next page.
#' @param format Return format for `/v1/query`.
#' @param shape Return shape for `/v1/query`.
#' @param aggregation Optional aggregation mode.
#' @param include_metadata Whether to include observation metadata.
#' @param include_feature_metadata Whether to include feature metadata.
#' @param measure Optional measure override.
#' @param layer Optional layer override.
#' @return A list matching Shennong Data Server `QuerySpec`.
#' @export
sn_query_spec <- function(
  x,
  features = NULL,
  fields = NULL,
  limit = NULL,
  cursor = NULL,
  format = "json",
  shape = "tidy",
  aggregation = NULL,
  include_metadata = TRUE,
  include_feature_metadata = FALSE,
  measure = NULL,
  layer = NULL
) {
  check_shennong_lazy(x)
  selected_features <- as.character(features %||% x$features %||% character())
  selected_fields <- as.character(fields %||% x$fields %||% character())
  page_limit <- as.integer(limit %||% x$options$limit %||% 1000L)
  if (is.na(page_limit) || page_limit < 1L) {
    rlang::abort("`limit` must be a positive integer.")
  }

  compact_nulls(list(
    dataset = x$dataset,
    version = x$version %||% "latest",
    assay = x$assay,
    data_model = x$data_model,
    select = list(
      features = selected_features,
      observations = x$observations,
      fields = selected_fields
    ),
    layer = layer %||% x$layer,
    measure = measure %||% x$measure,
    `return` = list(format = format, shape = shape),
    options = compact_nulls(list(
      limit = page_limit,
      cursor = cursor,
      include_metadata = include_metadata,
      include_feature_metadata = include_feature_metadata,
      aggregation = aggregation
    ))
  ))
}

compact_nulls <- function(x) {
  if (!is.list(x)) {
    return(x)
  }
  x <- lapply(x, compact_nulls)
  x[!vapply(x, is.null, logical(1))]
}
