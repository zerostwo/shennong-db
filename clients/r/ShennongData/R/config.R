#' Configure the Shennong Data Server URL
#'
#' @param url Base URL such as `http://127.0.0.1:18000`.
#' @return The previous configured URL, invisibly.
#' @export
sn_set_api_url <- function(url) {
  rlang::check_required(url)
  if (!is.character(url) || length(url) != 1L || !nzchar(url)) {
    rlang::abort("`url` must be a single non-empty string.")
  }
  old <- getOption("shennong.api_url")
  options(shennong.api_url = sub("/+$", "", url))
  invisible(old)
}

#' Get the configured Shennong Data Server URL
#'
#' The lookup order is `options("shennong.api_url")`,
#' `SHENNONG_API_URL`, then `http://127.0.0.1:18000`.
#'
#' @return A base URL string.
#' @export
sn_get_api_url <- function() {
  url <- getOption("shennong.api_url")
  if (is.character(url) && length(url) == 1L && nzchar(url)) {
    return(sub("/+$", "", url))
  }
  env_url <- Sys.getenv("SHENNONG_API_URL", unset = "")
  if (nzchar(env_url)) {
    return(sub("/+$", "", env_url))
  }
  "http://127.0.0.1:18000"
}

#' Configure an API bearer token
#'
#' @param token Token string, or `NULL` to clear the option.
#' @return The previous configured token, invisibly.
#' @export
sn_set_api_token <- function(token = NULL) {
  if (!is.null(token) && (!is.character(token) || length(token) != 1L || !nzchar(token))) {
    rlang::abort("`token` must be NULL or a single non-empty string.")
  }
  old <- getOption("shennong.api_token")
  options(shennong.api_token = token)
  invisible(old)
}

#' Get the configured API bearer token
#'
#' The lookup order is `options("shennong.api_token")`,
#' then `SHENNONG_API_TOKEN`.
#'
#' @return A token string or `NULL`.
#' @export
sn_get_api_token <- function() {
  token <- getOption("shennong.api_token")
  if (is.character(token) && length(token) == 1L && nzchar(token)) {
    return(token)
  }
  env_token <- Sys.getenv("SHENNONG_API_TOKEN", unset = "")
  if (nzchar(env_token)) {
    return(env_token)
  }
  NULL
}
