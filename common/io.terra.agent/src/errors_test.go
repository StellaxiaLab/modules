package main

import "errors"

func errorsAs(err error, target any) bool {
	switch typed := target.(type) {
	case **providerError:
		return errors.As(err, typed)
	}
	return false
}
