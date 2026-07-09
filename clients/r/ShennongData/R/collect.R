#' Collect a bounded page from Shennong Data Server
#'
#' This is the primary materialization point for lazy Shennong objects. It sends
#' a semantic `QuerySpec` to `/v1/query` and returns a tibble. By default only one
#' bounded page is fetched.
#'
#' @param x A lazy Shennong dataset.
#' @param features Feature names such as genes.
#' @param fields Observation or metadata fields to include.
#' @param limit Page size for this request.
#' @param cursor Optional cursor returned by a previous request.
#' @param all If `TRUE`, follow `meta.next_cursor` until exhausted or `limit`
#'   rows have been collected.
#' @param page_size Page size used when `all = TRUE`.
#' @param format Return format. Only `"json"` is collected into a tibble.
#' @param shape Return shape, usually `"tidy"`.
#' @param aggregation Optional aggregation mode.
#' @param measure Optional measure override.
#' @param layer Optional layer override.
#' @return A tibble with `attr(result, "shennong_meta")`.
#' @export
sn_collect <- function(
  x,
  features = NULL,
  fields = NULL,
  limit = NULL,
  cursor = NULL,
  all = FALSE,
  page_size = NULL,
  format = "json",
  shape = "tidy",
  aggregation = NULL,
  measure = NULL,
  layer = NULL
) {
  check_shennong_lazy(x)
  if (!identical(format, "json")) {
    rlang::abort("`sn_collect()` currently materializes only JSON responses.")
  }

  total_limit <- as.integer(limit %||% x$options$limit %||% 1000L)
  if (is.na(total_limit) || total_limit < 1L) {
    rlang::abort("`limit` must be a positive integer.")
  }

  if (!isTRUE(all)) {
    result <- sn_query_once(
      x,
      features = features,
      fields = fields,
      limit = total_limit,
      cursor = cursor,
      format = format,
      shape = shape,
      aggregation = aggregation,
      measure = measure,
      layer = layer
    )
    return(response_to_tibble(result))
  }

  current_cursor <- cursor
  rows <- list()
  metas <- list()
  fetched <- 0L
  current_page_size <- as.integer(page_size %||% min(total_limit, x$options$limit %||% 1000L))
  repeat {
    remaining <- total_limit - fetched
    if (remaining <= 0L) {
      break
    }
    result <- sn_query_once(
      x,
      features = features,
      fields = fields,
      limit = min(current_page_size, remaining),
      cursor = current_cursor,
      format = format,
      shape = shape,
      aggregation = aggregation,
      measure = measure,
      layer = layer
    )
    rows <- c(rows, result$data %||% list())
    metas[[length(metas) + 1L]] <- result$meta
    fetched <- length(rows)
    current_cursor <- result$meta$next_cursor %||% NULL
    if (is.null(current_cursor) || !nzchar(current_cursor)) {
      break
    }
  }
  out <- rows_to_tibble(rows)
  attr(out, "shennong_meta") <- metas[[length(metas)]] %||% list()
  out
}

#' Fetch expression for genes from a lazy dataset
#'
#' @param x A lazy Shennong dataset.
#' @param genes Character vector of genes or other feature ids.
#' @param ... Additional arguments passed to `sn_collect()`.
#' @return A tibble with one bounded result page by default.
#' @export
sn_fetch_genes <- function(x, genes, ...) {
  if (!is.character(genes) || !length(genes) || any(!nzchar(genes))) {
    rlang::abort("`genes` must be a non-empty character vector.")
  }
  sn_collect(x, features = genes, ...)
}

sn_query_once <- function(
  x,
  features,
  fields,
  limit,
  cursor,
  format,
  shape,
  aggregation,
  measure,
  layer
) {
  spec <- sn_query_spec(
    x,
    features = features,
    fields = fields,
    limit = limit,
    cursor = cursor,
    format = format,
    shape = shape,
    aggregation = aggregation,
    measure = measure,
    layer = layer
  )
  request_query(x, spec)
}

request_query <- function(x, spec) {
  url <- paste0(x$api_url, "/v1/query")
  req <- httr2::request(url)
  req <- httr2::req_headers(req, "user-agent" = "ShennongData R client/0.1.0")
  if (!is.null(x$token) && nzchar(x$token)) {
    req <- httr2::req_auth_bearer_token(req, x$token)
  }
  req <- httr2::req_body_json(req, spec, auto_unbox = TRUE, null = "null")
  resp <- httr2::req_perform(req)
  httr2::resp_check_status(resp)
  payload <- jsonlite::fromJSON(httr2::resp_body_string(resp), simplifyVector = FALSE)
  if (!identical(payload$status, "success")) {
    rlang::abort(payload$message %||% "Shennong query failed.")
  }
  payload
}

response_to_tibble <- function(response) {
  out <- rows_to_tibble(response$data %||% list())
  attr(out, "shennong_meta") <- response$meta %||% list()
  out
}

rows_to_tibble <- function(rows) {
  if (!length(rows)) {
    return(tibble::tibble())
  }
  json <- jsonlite::toJSON(rows, auto_unbox = TRUE, null = "null")
  tibble::as_tibble(jsonlite::fromJSON(json, flatten = TRUE))
}
